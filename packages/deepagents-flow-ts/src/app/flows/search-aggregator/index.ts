/**
 * search-aggregator — 四路并行联网检索 → 汇总（custom 拓扑 recipe）
 *
 * **联网搜索（强制）**：须到**平台**查找并添加搜索能力，再接入下方 SEARCH_MCP：
 *   dev-engineer-toolkit → search-apis.sh / get-config.sh mcpConfigs → 登记后填入 searchMcp
 * 图逻辑见 ./graph.ts。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../../../libs/topologies/types.js";
import type { TravelSearchMcp } from "../../../libs/topologies/travel-planner/graph.js";
import { buildGraph, getTopology as _getTopology } from "./graph.js";

/**
 * 平台查找并添加搜索 MCP 后在此配置（勿硬编码未登记 server）：
 *
 * 1. dev-engineer-toolkit：search-apis.sh --kw "搜索" / get-config.sh --key mcpConfigs
 * 2. 将平台返回的 MCP 配置映射为：
 * const SEARCH_MCP: TravelSearchMcp = {
 *   config: { command: "npx", args: ["-y", "平台登记的搜索包"] },
 *   tool: "search",
 * };
 */
const SEARCH_MCP: TravelSearchMcp | undefined = undefined;

export const recipe = (runtime: FlowRuntime): StatefulTopologyRecipe => ({
  buildGraph: (cp) => buildGraph(runtime.config, cp, SEARCH_MCP),
  toInput: (query) => ({ query }),
  toResult: (v) => {
    const answer = String((v as Record<string, unknown>).output ?? "");
    return { answer };
  },
});

export const getTopology = _getTopology;
