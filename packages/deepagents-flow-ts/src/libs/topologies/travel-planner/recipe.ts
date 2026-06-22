/**
 * travel-planner 拓扑的构造配方（StatefulTopologyRecipe）。
 * @param systemPrompt aggregate 节点角色开场（scaffold spec 注入；缺省「旅行规划师」）
 * @param searchMcp 搜索 MCP 源（{config, tool}）；缺省则 research 优雅降级（写「未配置搜索源」）
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../types.js";
import {
  createTravelGraph,
  type TravelStateType,
  type TravelSearchMcp,
} from "./graph.js";

export function travelRecipe(
  runtime: FlowRuntime,
  opts: { systemPrompt?: string; searchMcp?: TravelSearchMcp } = {}
): StatefulTopologyRecipe<TravelStateType> {
  return {
    buildGraph: (cp) =>
      createTravelGraph(runtime.config, cp, opts.systemPrompt, opts.searchMcp),
    toInput: (query) => ({ query }),
    toResult: (v) => ({ answer: v.output ?? "" }),
  };
}
