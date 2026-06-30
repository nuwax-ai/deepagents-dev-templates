/**
 * search-aggregator — 四路并行联网检索 → 汇总（custom：fanout + mcp-retrieval + aggregate）
 *
 * 联网检索须经平台 Plugin/MCP 登记；本地开发用 dev-engineer-toolkit 配置后，
 * 在 index.ts recipe 传入 searchMcp（同 travel-planner）。未配置则 research 优雅降级。
 *
 * **联网搜索**：须到平台查找并添加（dev-engineer-toolkit）；模板不硬编码检索源。
 */
import {
  StateGraph,
  Annotation,
  MemorySaver,
  START,
  END,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { AppConfig } from "../../../runtime/index.js";
import { createMcpRetrievalNode, createLlmStreamNode, requireModel, createFanout } from "../../../libs/nodes/index.js";
import { resolveLlmResilience } from "../../../runtime/services/llm-resilience.js";
import { reflectTopology } from "../../../libs/topologies/reflect.js";
import type { FlowTopology } from "../../../core/flow-types.js";
import type { TravelSearchMcp } from "../../../libs/topologies/travel-planner/graph.js";

const ASPECTS = ["overview", "news", "analysis", "sources"] as const;
const ASPECT_LABEL: Record<string, string> = {
  overview: "概述",
  news: "最新动态",
  analysis: "分析",
  sources: "资料来源",
};
/** 各维度 query 后缀（与用户 query 拼接，不含技术库 / 菜谱等硬编码源）。 */
const ASPECT_SUFFIX: Record<string, string> = {
  overview: "背景 概述",
  news: "最新动态 新闻",
  analysis: "分析 评论 趋势",
  sources: "资料 来源",
};

const State = Annotation.Root({
  query: Annotation<string>(),
  aspect: Annotation<string>(),
  findings: Annotation<unknown[]>({ reducer: (a, b) => [...(a ?? []), ...(b ?? [])], default: () => [] }),
  output: Annotation<string>(),
});
export type StateShape = typeof State.State;

/**
 * 按 spec 构造图（编译后）。searchMcp 缺省 → research 不写外网、findings 记降级文案。
 */
export function buildGraph(
  appConfig: AppConfig | undefined,
  checkpointer: BaseCheckpointSaver = new MemorySaver(),
  searchMcp?: TravelSearchMcp
) {
  return new StateGraph(State)
    .addNode("gather", ((() => ({})) as (s: StateShape) => Partial<StateShape>))
    .addNode(
      "research",
      createMcpRetrievalNode<StateShape>({
        mcpServers: searchMcp ? { search: searchMcp.config } : {},
        retrieve: (s) => {
          if (!searchMcp) return null;
          const query = `${s.query} ${ASPECT_SUFFIX[s.aspect] ?? s.aspect}`;
          return { server: "search", tool: searchMcp.tool, args: { query, count: 5 } };
        },
        write: (r, s) => ({
          findings: [
            `${ASPECT_LABEL[s.aspect] ?? s.aspect}：${
              r.ok && r.text
                ? r.text.slice(0, 200)
                : searchMcp
                  ? "（检索失败）"
                  : "（未配置：请至平台查找并添加搜索 MCP，再配置 searchMcp）"
            }`,
          ],
        }),
        label: "research",
      })
    )
    .addNode(
      "aggregate",
      createLlmStreamNode<StateShape>({
        model: () => requireModel(appConfig, "aggregate"),
        prompt: (s) => [
          new SystemMessage("把各维度联网搜索结果整理成简短摘要，按维度列出。"),
          new HumanMessage(s.findings.join(" / ")),
        ],
        write: (r) => ({ output: r.text }),
        config: appConfig,
        label: "aggregate",
        timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs,
      })
    )
    .addEdge(START, "gather")
    .addConditionalEdges(
      "gather",
      createFanout<(typeof ASPECTS)[number], StateShape>({
        items: () => [...ASPECTS],
        target: "research",
        input: (item, s) => ({ aspect: item, query: s.query }),
      }),
      ["research"]
    )
    .addEdge("research", "aggregate")
    .addEdge("aggregate", END)
    .compile({ checkpointer });
}

/** 静态拓扑反射（不运行图、不需凭证）。 */
export function getTopology(): Promise<FlowTopology> {
  return reflectTopology(buildGraph(undefined));
}
