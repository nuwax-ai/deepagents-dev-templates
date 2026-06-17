/**
 * 示例：旅行规划（travel planner）——【真实接入：并行 MCP 搜索 + LLM 整理 + HITL】
 *
 * 对应 LangGraph 官方：**Map-reduce（`Send` 扇出）** + **Human-in-the-loop**。
 *
 *   START → gather → ⟨Send 并行⟩ research × 4（交通/住宿/景点/美食，各发一次真实 DuckDuckGo 搜索）
 *         → aggregate（LLM 把搜索结果整理成 N 天行程）→ confirm(interrupt) → finalize → END
 *
 * 节点消费框架 factory（src/libs/nodes）：
 *  - fanoutToResearch → createFanout（Send map-reduce 扇出）；
 *  - aggregate → createLlmNode；confirm → createHumanApprovalNode。
 *  - 保留 bespoke：gather（纯解析）、research（真实 DDG MCP 检索 + rateLimited）、
 *    finalize（isApproval 短路，通过则不调 LLM）。
 *
 * 真实接入（无 demo fallback——未配凭证 / 无网直接报错）：
 *  - research 调**真实 MCP**（duckduckgo-mcp-server，免 key）；DDG 限 1 请求/秒，rateLimited 错峰。
 *  - aggregate / finalize 的 LLM 分支 **真调大模型**；onToolCall 透出每次搜索；HITL 用 interrupt。
 * ⚠️ 节点名不能与 state channel 同名。
 */

import {
  StateGraph,
  START,
  END,
  Annotation,
  MemorySaver,
  type BaseCheckpointSaver,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "../../src/runtime/index.js";
import type { StatefulFlow, FlowCallbacks } from "../../src/surfaces/flow-types.js";
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import { requireModel } from "../shared.js";
import {
  createLlmNode,
  createHumanApprovalNode,
  createFanout,
  runTool,
  isApproval,
  extractText,
} from "../../src/libs/nodes/index.js";
import { durableCheckpointer } from "../../src/runtime/services/file-checkpoint-saver.js";
import { invokeWithResilience, resolveLlmResilience } from "../../src/runtime/services/llm-resilience.js";
import { callResolvedMcpTool, rateLimited, type McpServerConfig } from "../mcp-client.js";

const log = logger.child("travel");

/** 免 key 的网络搜索 MCP（npx 启动）。换别的搜索 MCP 改这里即可。 */
const SEARCH_MCP: McpServerConfig = {
  command: "npx",
  args: ["-y", "duckduckgo-mcp-server"],
};

const ASPECTS = ["transport", "stay", "sights", "food"] as const;
const ASPECT_LABEL: Record<string, string> = {
  transport: "交通",
  stay: "住宿",
  sights: "景点",
  food: "美食",
};
const ASPECT_QUERY: Record<string, string> = {
  transport: "交通 出行 攻略",
  stay: "住宿 酒店 推荐",
  sights: "必去 景点 推荐",
  food: "美食 餐厅 推荐",
};

interface Finding {
  aspect: string;
  suggestion: string;
}

const TravelState = Annotation.Root({
  query: Annotation<string>,
  destination: Annotation<string>,
  days: Annotation<number>,
  /** Send 给每个 research 实例的输入（每个实例独立） */
  currentAspect: Annotation<string>,
  /** 并行写 → 必须用 reducer 聚合 */
  findings: Annotation<Finding[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  itinerary: Annotation<string>,
  feedback: Annotation<string>,
  output: Annotation<string>,
});
export type TravelStateType = typeof TravelState.State;

/** gather：解析目的地 + 天数（纯逻辑，导出供单测）。 */
export function gatherNode(state: TravelStateType): Partial<TravelStateType> {
  const q = state.query.trim();
  const daysMatch = q.match(/(\d+)\s*(天|日|days?)/i);
  const days = daysMatch ? Math.max(1, parseInt(daysMatch[1]!, 10)) : 3;
  const rest = q.replace(/(\d+)\s*(天|日|days?)/gi, " ").trim();
  const destination = rest.split(/[\s,，]+/)[0] || "目的地";
  log.info("gather", { destination, days });
  return { destination, days, findings: [] };
}

/** 条件边：对每个 aspect 派一个 research 实例（map 扇出，导出供单测）。框架 createFanout。 */
export const fanoutToResearch = createFanout<(typeof ASPECTS)[number], TravelStateType>({
  items: () => [...ASPECTS],
  target: "research",
  input: (aspect, s) => ({
    currentAspect: aspect,
    destination: s.destination,
    days: s.days,
  }),
});

/** research：对单个 aspect 发一次真实 DuckDuckGo 搜索（并行实例之一；rateLimited 节流到 ≤1/秒）。
 *  保留 bespoke——自定义 MCP 检索 + rateLimited，非 ToolNode 模式。 */
async function researchNode(
  state: TravelStateType,
  config?: LangGraphRunnableConfig
): Promise<Partial<TravelStateType>> {
  const onToolCall = config?.configurable?.onToolCall as
    | FlowCallbacks["onToolCall"]
    | undefined;
  const aspect = state.currentAspect;
  const query = `${state.destination} ${ASPECT_QUERY[aspect] ?? aspect}`;
  const { result, ok } = await runTool(
    "duckduckgo_search",
    { query },
    () =>
      rateLimited(() =>
        callResolvedMcpTool(
          SEARCH_MCP,
          "duckduckgo_search",
          { query, count: 5 },
          { timeoutMs: 20000 }
        )
      ),
    onToolCall
  );
  // 截断原始搜索结果，交给 aggregate 的 LLM 整理
  const suggestion = ok
    ? result.slice(0, 800)
    : `（${ASPECT_LABEL[aspect] ?? aspect}搜索失败：${result}）`;
  return { findings: [{ aspect, suggestion }] };
}

/** finalize：通过则定稿；否则 LLM 按意见改写行程。
 *  保留 bespoke——isApproval 短路（通过则不调 LLM）。 */
async function finalizeNode(
  state: TravelStateType,
  appConfig?: AppConfig
): Promise<Partial<TravelStateType>> {
  const fb = (state.feedback ?? "").trim();
  if (isApproval(fb)) {
    return { output: `✅ 行程已确认：\n${state.itinerary}` };
  }
  const model = requireModel(appConfig, "travel-planner 示例");
  const { longTimeoutMs } = resolveLlmResilience(appConfig);
  const res = await invokeWithResilience(
    model,
    [
      new SystemMessage("根据用户的调整意见修订行程，只输出修订后的完整行程。"),
      new HumanMessage(`原行程：\n${state.itinerary}\n\n调整意见：${fb}`),
    ],
    { timeoutMs: longTimeoutMs, label: "travel finalize", retryLabel: "travel LLM", config: appConfig }
  );
  return { output: `✏️ 已按意见调整：\n${extractText(res.content).trim()}` };
}

export function createTravelGraph(
  appConfig?: AppConfig,
  checkpointer: BaseCheckpointSaver = new MemorySaver()
) {
  // aggregate：框架 createLlmNode（把 4 路搜索结果整理成按天行程）。
  const aggregate = createLlmNode<TravelStateType>({
    model: () => requireModel(appConfig, "travel-planner 示例"),
    prompt: (s) => {
      const ordered = ASPECTS.map((a) => s.findings.find((f) => f.aspect === a)).filter(
        (f): f is Finding => Boolean(f)
      );
      const material = ordered
        .map((f) => `# ${ASPECT_LABEL[f.aspect] ?? f.aspect}\n${f.suggestion}`)
        .join("\n\n");
      return [
        new SystemMessage(
          `你是旅行规划师。根据各方面的网络搜索结果，为「${s.destination}」规划一个 ${s.days} 天的行程，按天列出（含交通/住宿/景点/美食），简洁实用，不要堆砌链接。`
        ),
        new HumanMessage(`网络搜索素材：\n${material}`),
      ];
    },
    write: (r) => ({ itinerary: r.content.trim() }),
    config: appConfig,
    label: "travel aggregate",
    retryLabel: "travel LLM",
    timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs,
  });

  // confirm：框架 createHumanApprovalNode（interrupt 把行程抛给用户确认 → 写 feedback）。
  const confirm = createHumanApprovalNode<TravelStateType>({
    question: (s) =>
      `${s.itinerary}\n\n以上行程 OK 吗？要调整（预算 / 天数 / 偏好）就说一下，或回复「ok」确认。`,
    write: (feedback) => ({ feedback }),
  });

  return new StateGraph(TravelState)
    .addNode("gather", gatherNode)
    .addNode("research", researchNode)
    .addNode("aggregate", aggregate)
    .addNode("confirm", confirm)
    .addNode("finalize", (s: TravelStateType) => finalizeNode(s, appConfig))
    .addEdge(START, "gather")
    .addConditionalEdges("gather", fanoutToResearch, ["research"])
    .addEdge("research", "aggregate")
    .addEdge("aggregate", "confirm")
    .addEdge("confirm", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer });
}

/**
 * 包装成模板 StatefulFlow：run({query})→并行搜索+整理后在 confirm interrupt；run({resume})→finalize。
 * 经 createStatefulFlow 统一 run-loop + 持久化 resume；onToolCall 由基座经 configurable 透传给并行
 * research 实例。checkpointer 默认 FileCheckpointSaver（跨重启续跑），单测可注入 MemorySaver。
 */
export function createTravelFlow(
  appConfig?: AppConfig,
  opts: { checkpointer?: BaseCheckpointSaver } = {}
): StatefulFlow {
  return createStatefulFlow<TravelStateType>({
    buildGraph: (cp) => createTravelGraph(appConfig, cp),
    toInput: (query) => ({ query }),
    toResult: (v) => ({ answer: v.output ?? "" }),
    checkpointer: durableCheckpointer(appConfig, opts.checkpointer),
    appConfig, // 自动压缩（基座在新 query 入口按阈值压 messages）
  });
}
