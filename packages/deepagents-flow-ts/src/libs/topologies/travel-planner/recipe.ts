/**
 * travel-planner 拓扑的构造配方（StatefulTopologyRecipe）。
 * @param systemPrompt aggregate 节点角色开场（scaffold spec 注入；缺省「旅行规划师」）
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../types.js";
import { createTravelGraph, type TravelStateType } from "./graph.js";

export function travelRecipe(
  runtime: FlowRuntime,
  opts: { systemPrompt?: string } = {}
): StatefulTopologyRecipe<TravelStateType> {
  return {
    buildGraph: (cp) => createTravelGraph(runtime.config, cp, opts.systemPrompt),
    toInput: (query) => ({ query }),
    toResult: (v) => ({ answer: v.output ?? "" }),
  };
}
