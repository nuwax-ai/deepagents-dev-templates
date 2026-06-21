/**
 * human-in-loop 拓扑的构造配方（StatefulTopologyRecipe）。
 *
 * recipe 仅读 runtime.config（appConfig）；checkpointer + appConfig（压缩）由组合根
 * index.ts 的 materializeFlow 注入。createStatefulFlow 仅 root 调，规避 libs→surfaces。
 *
 * @param systemPrompt compose 节点系统提示词（scaffold spec 注入；缺省回退领域默认）
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../types.js";
import { createReviewGraph, type ReviewStateType } from "./graph.js";

export function reviewRecipe(
  runtime: FlowRuntime,
  opts: { systemPrompt?: string } = {}
): StatefulTopologyRecipe<ReviewStateType> {
  return {
    buildGraph: (cp) => createReviewGraph(runtime.config, cp, opts.systemPrompt),
    toInput: (query) => ({ query }),
    toResult: (v) => ({ answer: v.output ?? "" }),
  };
}
