/**
 * grade-redo — custom 节点级拓扑（scaffold 生成的真实 TS，可手改）
 * 草稿 → 评审 → 不合格重做（节点级 custom：conditional 边 + llm parse）
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
import { createLlmNode, requireModel, parseJson } from "../../../libs/nodes/index.js";
import { reflectTopology } from "../../../libs/topologies/reflect.js";
import type { FlowTopology } from "../../../core/flow-types.js";

const State = Annotation.Root({
  query: Annotation<string>(),
  draft: Annotation<string>(),
  verdict: Annotation<string>(),
  attempts: Annotation<number>(),
});
export type StateShape = typeof State.State;

/** 按 spec 构造图（编译后）。被 index.ts 的 recipe.buildGraph 调用。 */
export function buildGraph(appConfig: AppConfig | undefined, checkpointer: BaseCheckpointSaver = new MemorySaver()) {
  return new StateGraph(State)
    .addNode("write", createLlmNode<StateShape>({
      model: () => requireModel(appConfig, "write"),
      prompt: (s) => [new SystemMessage('按用户要求写一段草稿。'), new HumanMessage(s.query)],
      write: (r) => ({ draft: r.content }),
      config: appConfig,
      label: "write",
    }))
    .addNode("grade", createLlmNode<StateShape>({
      model: () => requireModel(appConfig, "grade"),
      prompt: (s) => [new SystemMessage('评判草稿质量，只输出 JSON：{"verdict":"pass"|"fail"}'), new HumanMessage(s.draft)],
      write: (r, s) => ({ verdict: ((r.parsed ?? {}) as { verdict?: string }).verdict === 'pass' ? 'pass' : 'fail', attempts: (s.attempts ?? 0) + 1 }),
      parse: (t) => parseJson(t),
      config: appConfig,
      label: "grade",
    }))
    .addEdge(START, "write")
    .addEdge("write", "grade")
    .addConditionalEdges("grade", (s) => (s.verdict === 'fail' && (s.attempts ?? 0) < 3) ? 'write' : '__end__', { "write": "write", "__end__": END })
    .compile({ checkpointer });
}

/** 静态拓扑反射（不运行图、不需凭证）。 */
export function getTopology(): Promise<FlowTopology> {
  return reflectTopology(buildGraph(undefined));
}
