/**
 * 示例：旅行规划（travel planner）——【真实接入：并行 MCP 搜索 + LLM 整理 + HITL】
 *
 * 对应 LangGraph 官方：**Map-reduce（`Send` 扇出）** + **Human-in-the-loop**。
 *
 *   START → gather → ⟨Send 并行⟩ research × 4（交通/住宿/景点/美食，各发一次真实 DuckDuckGo 搜索）
 *         → aggregate（LLM 把搜索结果整理成 N 天行程）→ confirm(interrupt) → finalize → END
 *
 * 真实接入（无 demo fallback——未配凭证 / 无网直接报错）：
 *  - research 调**真实 MCP**（duckduckgo-mcp-server，免 key）做网络搜索；
 *    DDG 限 1 请求/秒，用 rateLimited 把并行调用串行化（图仍并行，外部请求错峰）。
 *  - aggregate / finalize **真调大模型**整理与改写。
 *  - onToolCall 透出每次搜索；HITL 用 interrupt 暂停确认。
 * ⚠️ 节点名不能与 state channel 同名。
 */

import {
  StateGraph,
  START,
  END,
  Annotation,
  Send,
  MemorySaver,
  interrupt,
  Command,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "deepagents-app-ts/runtime";
import type {
  StatefulFlow,
  FlowRunResult,
  FlowCallbacks,
} from "../../src/surfaces/flow-types.js";
import { requireModel, extractText, runTool, isApproval } from "../shared.js";
import { callMcpTool, rateLimited, type McpServerConfig } from "../mcp-client.js";

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

/** 条件边：对每个 aspect 派一个 research 实例（map 扇出，导出供单测）。 */
export function fanoutToResearch(state: TravelStateType): Send[] {
  return ASPECTS.map(
    (aspect) =>
      new Send("research", {
        currentAspect: aspect,
        destination: state.destination,
        days: state.days,
      })
  );
}

/** research：对单个 aspect 发一次真实 DuckDuckGo 搜索（并行实例之一；rateLimited 节流到 ≤1/秒）。 */
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
    () => rateLimited(() => callMcpTool(SEARCH_MCP, "duckduckgo_search", { query, count: 5 }, 20000)),
    onToolCall
  );
  // 截断原始搜索结果，交给 aggregate 的 LLM 整理
  const suggestion = ok
    ? result.slice(0, 800)
    : `（${ASPECT_LABEL[aspect] ?? aspect}搜索失败：${result}）`;
  return { findings: [{ aspect, suggestion }] };
}

/** aggregate：等所有并行 research 完成后，LLM 把 4 路搜索结果整理成按天行程。 */
async function aggregateNode(
  state: TravelStateType,
  appConfig?: AppConfig
): Promise<Partial<TravelStateType>> {
  const model = requireModel(appConfig, "travel-planner 示例");
  const ordered = ASPECTS.map((a) =>
    state.findings.find((f) => f.aspect === a)
  ).filter((f): f is Finding => Boolean(f));
  const material = ordered
    .map((f) => `# ${ASPECT_LABEL[f.aspect] ?? f.aspect}\n${f.suggestion}`)
    .join("\n\n");
  const res = await model.invoke([
    new SystemMessage(
      `你是旅行规划师。根据各方面的网络搜索结果，为「${state.destination}」规划一个 ${state.days} 天的行程，按天列出（含交通/住宿/景点/美食），简洁实用，不要堆砌链接。`
    ),
    new HumanMessage(`网络搜索素材：\n${material}`),
  ]);
  return { itinerary: extractText(res.content).trim() };
}

/** confirm：interrupt 暂停，把行程草案抛给用户确认/调整。 */
function confirmNode(state: TravelStateType): Partial<TravelStateType> {
  const feedback = interrupt({
    question: `${state.itinerary}\n\n以上行程 OK 吗？要调整（预算 / 天数 / 偏好）就说一下，或回复「ok」确认。`,
  });
  return { feedback: String(feedback ?? "").trim() };
}

/** finalize：通过则定稿；否则 LLM 按意见改写行程。 */
async function finalizeNode(
  state: TravelStateType,
  appConfig?: AppConfig
): Promise<Partial<TravelStateType>> {
  const fb = (state.feedback ?? "").trim();
  if (isApproval(fb)) {
    return { output: `✅ 行程已确认：\n${state.itinerary}` };
  }
  const model = requireModel(appConfig, "travel-planner 示例");
  const res = await model.invoke([
    new SystemMessage("根据用户的调整意见修订行程，只输出修订后的完整行程。"),
    new HumanMessage(`原行程：\n${state.itinerary}\n\n调整意见：${fb}`),
  ]);
  return { output: `✏️ 已按意见调整：\n${extractText(res.content).trim()}` };
}

export function createTravelGraph(appConfig?: AppConfig) {
  return new StateGraph(TravelState)
    .addNode("gather", gatherNode)
    .addNode("research", researchNode)
    .addNode("aggregate", (s: TravelStateType) => aggregateNode(s, appConfig))
    .addNode("confirm", confirmNode)
    .addNode("finalize", (s: TravelStateType) => finalizeNode(s, appConfig))
    .addEdge(START, "gather")
    .addConditionalEdges("gather", fanoutToResearch, ["research"])
    .addEdge("research", "aggregate")
    .addEdge("aggregate", "confirm")
    .addEdge("confirm", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer: new MemorySaver() });
}

/**
 * 包装成模板 StatefulFlow：run({query})→并行搜索+整理后在 confirm interrupt；run({resume})→finalize。
 * onToolCall 经 config.configurable 透传给并行的 research 实例。
 */
export function createTravelFlow(appConfig?: AppConfig): StatefulFlow {
  const graph = createTravelGraph(appConfig);
  return {
    async run(input, threadId, callbacks): Promise<FlowRunResult> {
      const config = {
        configurable: { thread_id: threadId, onToolCall: callbacks?.onToolCall },
      };
      const stream =
        input.resume !== undefined
          ? await graph.stream(new Command({ resume: input.resume }), config)
          : await graph.stream({ query: input.query ?? "" }, config);

      let interruptValue: unknown;
      for await (const chunk of stream) {
        const intr = (chunk as Record<string, unknown>).__interrupt__ as
          | Array<{ value?: unknown }>
          | undefined;
        if (intr && intr.length) interruptValue = intr[0]?.value;
      }

      if (interruptValue !== undefined) {
        const q =
          (interruptValue as { question?: string })?.question ??
          String(interruptValue);
        return { status: "interrupted", question: q };
      }
      const snapshot = await graph.getState(config);
      return { status: "done", answer: (snapshot.values as TravelStateType).output ?? "" };
    },
  };
}
