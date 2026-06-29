/**
 * multi-aspect-search — custom 节点级拓扑（scaffold 生成的真实 TS，可手改）
 * 多维度并行搜索 → 汇总（节点级 custom：fanout + mcp-retrieval + array 聚合）
 *
 * 本文件由 spec 渲染成真实 StateGraph：节点用 libs/nodes factory，prompt/route 等为内联真实代码
 * （受 tsc 检查）。改图直接改这里的 addNode / addEdge。节点 type 词表见 docs/node-catalog.md。
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

const State = Annotation.Root({
  query: Annotation<string>(),
  aspect: Annotation<string>(),
  findings: Annotation<unknown[]>({ reducer: (a, b) => [...(a ?? []), ...(b ?? [])], default: () => [] }),
  output: Annotation<string>(),
});
export type StateShape = typeof State.State;

/** 按 spec 构造图（编译后）。被 index.ts 的 recipe.buildGraph 调用。 */
export function buildGraph(appConfig: AppConfig | undefined, checkpointer: BaseCheckpointSaver = new MemorySaver()) {
  return new StateGraph(State)
    .addNode("gather", ((() => ({})) as (s: StateShape) => Partial<StateShape>))
    .addNode("research", createMcpRetrievalNode<StateShape>({
      mcpServers: {"context7":{"command":"npx","args":["-y","@upstash/context7-mcp"]}},
      retrieve: (s) => ({ server: 'context7', tool: 'query-docs', args: { libraryId: '/langchain-ai/langgraph', query: `${s.aspect}` } }),
      write: (r, s) => ({ findings: [`${s.aspect}：${r.ok ? r.text.slice(0, 120) : '（检索失败）'}`] }),
      label: "research",
    }))
    .addNode("aggregate", createLlmStreamNode<StateShape>({
      model: () => requireModel(appConfig, "aggregate"),
      prompt: (s) => [new SystemMessage('把各维度搜索结果整理成简短摘要，按维度列出。'), new HumanMessage(s.findings.join(' / '))],
      write: (r) => ({ output: r.text }),
      config: appConfig,
      label: "aggregate",
      timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs,
    }))
    .addEdge(START, "gather")
    .addConditionalEdges(
      "gather",
      createFanout<unknown, StateShape>({ items: () => ['StateGraph', 'Send', 'interrupt'], target: "research", input: (item, s) => ({ aspect: item, query: s.query }) }),
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
