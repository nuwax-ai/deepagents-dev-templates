/**
 * travel-planner 拓扑图 —— Map-reduce（Send 扇出）+ HITL（自 examples/travel-planner 提升）。
 *
 *   START → gather → ⟨Send 并行⟩ research × 4（交通/住宿/景点/美食，各发一次真实 DDG 搜索）
 *         → aggregate（LLM 整理成 N 天行程）→ confirm(interrupt) → finalize → END
 *
 * 节点消费框架 factory：aggregate=createLlmNode；confirm=createHumanApprovalNode；
 * fanoutToResearch=createFanout（Send map-reduce 扇出）。保留 bespoke：gather（纯解析）、
 * research（真实 MCP 检索 + rateLimited）、finalize（isApproval 短路）。
 *
 * systemPrompt 注入主节点 aggregate（角色开场）；research/confirm/finalize 领域默认。
 * 零 surface 依赖 —— 可放 libs；createStatefulFlow 包装由 root / examples 各自做。
 */
import {
  StateGraph,
  START,
  END,
  Annotation,
  MemorySaver,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "../../../runtime/index.js";
import {
  createLlmNode,
  createHumanApprovalNode,
  createApprovalFinalizeNode,
  createMcpRetrievalNode,
  createFanout,
  requireModel,
} from "../../nodes/index.js";
import { resolveLlmResilience } from "../../../runtime/services/llm-resilience.js";
import type { McpServerConfig } from "../../mcp/stdio-client.js";

const log = logger.child("travel");

/**
 * 搜索 MCP 源（createTravelGraph 的 searchMcp 参数传入）。
 * ⚠️ duckduckgo-mcp-server 实测不稳定，已不再作为默认。传入可用的搜索 MCP（如自建 stdio 搜索 server），
 *    或改用 http_request 工具调搜索 API；未传则 research 节点优雅降级（写「未配置搜索源」）。
 */
export interface TravelSearchMcp {
  config: McpServerConfig;
  /** MCP 工具名（如 "search"）。 */
  tool: string;
}

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

export const TravelState = Annotation.Root({
  query: Annotation<string>,
  destination: Annotation<string>,
  days: Annotation<number>,
  /** Send 给每个 research 实例的输入（每个实例独立）。 */
  currentAspect: Annotation<string>,
  /** 并行写 → 必须用 reducer 聚合。 */
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

/**
 * 创建 travel 图（编译后的 LangGraph）。
 * @param systemPrompt aggregate 节点角色开场（scaffold 注入；缺省「旅行规划师」）
 * @param searchMcp 搜索 MCP 源（{config, tool}）；缺省则 research 优雅降级（不调外部搜索）
 */
export function createTravelGraph(
  appConfig?: AppConfig,
  checkpointer: BaseCheckpointSaver = new MemorySaver(),
  systemPrompt?: string,
  searchMcp?: TravelSearchMcp
) {
  const role = systemPrompt?.trim() || "你是旅行规划师";

  // research：框架 createMcpRetrievalNode（对单个 aspect 发一次搜索；rateLimited 节流 + runTool 三态透出）。
  // searchMcp 未传 → retrieve 返回 null → 优雅降级（写「未配置搜索源」，不崩）。
  const research = createMcpRetrievalNode<TravelStateType>({
    mcpServers: searchMcp ? { search: searchMcp.config } : {},
    retrieve: (s) => {
      if (!searchMcp) return null;
      const query = `${s.destination} ${ASPECT_QUERY[s.currentAspect] ?? s.currentAspect}`;
      return { server: "search", tool: searchMcp.tool, args: { query, count: 5 } };
    },
    write: (r, s) => ({
      findings: [
        {
          aspect: s.currentAspect,
          // 截断原始搜索结果，交给 aggregate 的 LLM 整理。
          suggestion: r.ok
            ? r.text.slice(0, 800)
            : `（${ASPECT_LABEL[s.currentAspect] ?? s.currentAspect}搜索失败/未配置：${r.text}）`,
        },
      ],
    }),
  });

  // aggregate：框架 createLlmNode（把 4 路搜索结果整理成按天行程）。
  const aggregate = createLlmNode<TravelStateType>({
    model: () => requireModel(appConfig, "travel-planner 拓扑"),
    prompt: (s) => {
      const ordered = ASPECTS.map((a) => s.findings.find((f) => f.aspect === a)).filter(
        (f): f is Finding => Boolean(f)
      );
      const material = ordered
        .map((f) => `# ${ASPECT_LABEL[f.aspect] ?? f.aspect}\n${f.suggestion}`)
        .join("\n\n");
      return [
        new SystemMessage(
          `${role}。根据各方面的网络搜索结果，为「${s.destination}」规划一个 ${s.days} 天的行程，按天列出（含交通/住宿/景点/美食），简洁实用，不要堆砌链接。`
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

  // finalize：框架 createApprovalFinalizeNode（isApproval 短路定稿 / 否则 LLM 按意见修订）。
  const finalize = createApprovalFinalizeNode<TravelStateType>({
    approvedOutput: (s) => ({ output: `✅ 行程已确认：\n${s.itinerary}` }),
    rejectedLlm: {
      model: () => requireModel(appConfig, "travel-planner 拓扑"),
      prompt: (s) => [
        new SystemMessage("根据用户的调整意见修订行程，只输出修订后的完整行程。"),
        new HumanMessage(`原行程：\n${s.itinerary}\n\n调整意见：${s.feedback}`),
      ],
      write: (r) => ({ output: `✏️ 已按意见调整：\n${r.content.trim()}` }),
      config: appConfig,
      label: "travel finalize",
      retryLabel: "travel LLM",
      timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs,
    },
  });

  return new StateGraph(TravelState)
    .addNode("gather", gatherNode)
    .addNode("research", research)
    .addNode("aggregate", aggregate)
    .addNode("confirm", confirm)
    .addNode("finalize", finalize)
    .addEdge(START, "gather")
    .addConditionalEdges("gather", fanoutToResearch, ["research"])
    .addEdge("research", "aggregate")
    .addEdge("aggregate", "confirm")
    .addEdge("confirm", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer });
}
