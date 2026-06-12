/**
 * 默认 Flow Graph —— 通用工作流模板的"空图骨架"。
 *
 *   START → prepare → act → decide ─(条件边)─┐
 *                      ▲                      ├─ retry & 未达上限 → act（再来一轮）
 *                      └──────────────────────┘
 *                                   └─ 否则 → respond → END
 *
 * 想改编排?改下面的 addNode / addEdge / addConditionalEdges 即可。
 * 完整的、有真实节点逻辑的范例见 examples/rag/。
 */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { logger } from "deepagents-app-ts/runtime";
import { prepareNode } from "./nodes/prepare.js";
import { actNode } from "./nodes/act.js";
import { decideNode, routeAfterDecide } from "./nodes/decide.js";
import { respondNode } from "./nodes/respond.js";

const log = logger.child("flow-graph");

const FlowStateAnnotation = Annotation.Root({
  input: Annotation<string>,
  history: Annotation<BaseMessage[]>,
  steps: Annotation<string[]>,
  attempts: Annotation<number>,
  decision: Annotation<string>,
  output: Annotation<string>,
});

type FlowStateType = typeof FlowStateAnnotation.State;

/** 创建默认 flow 图（编译后的 LangGraph 图）。 */
export function createFlowGraph() {
  const graph = new StateGraph(FlowStateAnnotation)
    .addNode("prepare", (s: FlowStateType) => prepareNode(s))
    .addNode("act", (s: FlowStateType) => actNode(s))
    .addNode("decide", (s: FlowStateType) => decideNode(s))
    .addNode("respond", (s: FlowStateType) => respondNode(s))
    .addEdge(START, "prepare")
    .addEdge("prepare", "act")
    .addEdge("act", "decide")
    .addConditionalEdges("decide", routeAfterDecide, {
      act: "act",
      respond: "respond",
    })
    .addEdge("respond", END);

  log.info("Flow graph compiled: START → prepare → act → decide →(cond) act|respond → END");
  return graph.compile();
}

/** 跑一次默认 flow。 */
export async function executeFlow(
  input: string,
  options: { history?: BaseMessage[] } = {}
): Promise<{ output: string; steps: string[] }> {
  const graph = createFlowGraph();
  const result = await graph.invoke({ input, history: options.history ?? [] });
  return { output: result.output ?? "", steps: result.steps ?? [] };
}

export { FlowStateAnnotation };
export type { FlowStateType };
