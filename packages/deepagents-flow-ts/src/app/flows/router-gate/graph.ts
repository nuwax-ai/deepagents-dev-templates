/**
 * router-gate — custom 节点级拓扑（scaffold 生成的真实 TS，可手改）
 * LLM 裁决门：pass→done，fail→redo（节点级 custom：llm-router Command goto）
 *
 * 本文件由 spec 渲染成真实 StateGraph：节点用 libs/nodes factory，prompt/route 等为内联真实代码
 * （受 tsc 检查）。改图直接改这里的 addNode / addEdge。节点 type 词表见 docs/node-catalog.md。
 */
import {
  StateGraph,
  Annotation,
  MemorySaver,
  START,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { AppConfig } from "../../../runtime/index.js";
import { createLlmNode, createLlmRouterNode, requireModel, parseJson } from "../../../libs/nodes/index.js";
import { reflectTopology } from "../../../libs/topologies/reflect.js";
import type { FlowTopology } from "../../../core/flow-types.js";

const State = Annotation.Root({
  query: Annotation<string>(),
  verdict: Annotation<string>(),
  output: Annotation<string>(),
});
export type StateShape = typeof State.State;

/** 按 spec 构造图（编译后）。被 index.ts 的 recipe.buildGraph 调用。 */
export function buildGraph(appConfig: AppConfig | undefined, checkpointer: BaseCheckpointSaver = new MemorySaver()) {
  return new StateGraph(State)
    .addNode("draft", createLlmNode<StateShape>({
      model: () => requireModel(appConfig, "draft"),
      prompt: (s) => [new SystemMessage('写一句草稿。'), new HumanMessage(s.query)],
      write: (r) => ({ output: r.content }),
      config: appConfig,
      label: "draft",
    }))
    .addNode("gate", createLlmRouterNode<StateShape>({
      model: () => requireModel(appConfig, "gate"),
      prompt: (s) => [new SystemMessage('评判，只输出 JSON：{"verdict":"pass"|"fail"}'), new HumanMessage(s.output)],
      parse: (t) => parseJson(t),
      route: (parsed) => { const v = (parsed ?? {}) as { verdict?: string }; const verdict = v.verdict === 'fail' ? 'fail' : 'pass'; return { goto: verdict === 'fail' ? 'draft' : '__end__', update: { verdict } }; },
      routeFallback: () => ({ goto: '__end__', update: { verdict: 'pass' } }),
      config: appConfig,
      label: "gate",
    }))
    .addEdge(START, "draft")
    .addEdge("draft", "gate")
    .compile({ checkpointer });
}

/** 静态拓扑反射（不运行图、不需凭证）。 */
export function getTopology(): Promise<FlowTopology> {
  return reflectTopology(buildGraph(undefined));
}
