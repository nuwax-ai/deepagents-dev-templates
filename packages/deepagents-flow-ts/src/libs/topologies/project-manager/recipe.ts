/**
 * project-manager 拓扑的构造配方（StatefulTopologyRecipe）。
 * @param systemPrompt plan 节点角色开场（scaffold spec 注入；缺省「资深项目经理」）
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../types.js";
import { createPMGraph, type PMStateType } from "./graph.js";

export function pmRecipe(
  runtime: FlowRuntime,
  opts: { systemPrompt?: string } = {}
): StatefulTopologyRecipe<PMStateType> {
  return {
    buildGraph: (cp) => createPMGraph(runtime.config, cp, opts.systemPrompt),
    toInput: (query) => ({ goal: query }),
    toResult: (v) => ({ answer: v.output ?? "" }),
  };
}
