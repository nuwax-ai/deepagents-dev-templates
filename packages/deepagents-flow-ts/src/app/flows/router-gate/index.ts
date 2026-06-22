/**
 * router-gate — custom 拓扑 recipe（scaffold 生成）。图见 ./graph.ts。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../../../libs/topologies/types.js";
import { buildGraph, getTopology as _getTopology } from "./graph.js";

export const recipe = (runtime: FlowRuntime): StatefulTopologyRecipe => ({
  buildGraph: (cp) => buildGraph(runtime.config, cp),
  toInput: (query) => ({ "query": query }),
  toResult: (v) => {
    const answer = String((v as Record<string, unknown>)["output"] ?? "");
    return { answer };
  },
  recursionLimit: 6,
});

export const getTopology = _getTopology;
