/**
 * 旅行规划示例（travel-planner）——【图逻辑已提升至 src/libs/topologies/travel-planner】。
 *
 * 本文件保留 example 的 createTravelFlow（StatefulFlow 包装）+ 纯函数导出（gatherNode /
 * fanoutToResearch，供单测）；图构造委托拓扑的 createTravelGraph（单一权威，零重复）。
 *
 *   START → gather → ⟨Send 并行⟩ research × 4 → aggregate → confirm(interrupt) → finalize → END
 */
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import { durableCheckpointer } from "../../src/runtime/services/file-checkpoint-saver.js";
import {
  createTravelGraph,
  getTravelTopology,
  type TravelStateType,
  type TravelSearchMcp,
  gatherNode,
  fanoutToResearch,
} from "../../src/libs/topologies/travel-planner/index.js";
import type { StatefulFlow } from "../../src/core/flow-types.js";
import type { AppConfig } from "../../src/runtime/index.js";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

export {
  getTravelTopology,
  gatherNode,
  fanoutToResearch,
  type TravelStateType,
  type TravelSearchMcp,
};

/**
 * 包装成模板 StatefulFlow：run({query})→并行搜索+整理后在 confirm interrupt；run({resume})→finalize。
 * 经 createStatefulFlow 统一 run-loop + 持久化 resume；checkpointer 默认 FileCheckpointSaver。
 * @param opts.searchMcp 搜索 MCP 源（{config, tool}）；缺省则 research 优雅降级（不搜索）
 */
export function createTravelFlow(
  appConfig?: AppConfig,
  opts: { checkpointer?: BaseCheckpointSaver; searchMcp?: TravelSearchMcp } = {}
): StatefulFlow {
  return createStatefulFlow<TravelStateType>({
    buildGraph: (cp) => createTravelGraph(appConfig, cp, undefined, opts.searchMcp),
    toInput: (query) => ({ query }),
    toResult: (v) => ({ answer: v.output ?? "" }),
    checkpointer: durableCheckpointer(appConfig, opts.checkpointer),
    appConfig,
  });
}
