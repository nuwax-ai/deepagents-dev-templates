/**
 * 项目管理示例（project-manager）——【图逻辑已提升至 src/libs/topologies/project-manager】。
 *
 * 本文件保留 example 的 createPMFlow（StatefulFlow 包装）+ 纯函数导出（routeAfterEvaluate /
 * MAX_REPLAN，供单测）；图构造委托拓扑的 createPMGraph（单一权威，零重复）。
 *
 *   START → plan → estimate → evaluate →(cond) plan|approve → finalize → END
 */
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import { durableCheckpointer } from "../../src/runtime/services/file-checkpoint-saver.js";
import {
  createPMGraph,
  getPMTopology,
  type PMStateType,
  routeAfterEvaluate,
  MAX_REPLAN,
} from "../../src/libs/topologies/project-manager/index.js";
import type { StatefulFlow } from "../../src/core/flow-types.js";
import type { AppConfig } from "../../src/runtime/index.js";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

export { getPMTopology, routeAfterEvaluate, MAX_REPLAN, type PMStateType };

/**
 * 包装成模板 StatefulFlow：run({query})→评估循环跑到 approve 的 interrupt；run({resume})→finalize。
 * 经 createStatefulFlow 统一 run-loop + 持久化 resume（默认 FileCheckpointSaver，跨重启续跑）。
 */
export function createPMFlow(
  appConfig?: AppConfig,
  opts: { checkpointer?: BaseCheckpointSaver } = {}
): StatefulFlow {
  return createStatefulFlow<PMStateType>({
    buildGraph: (cp) => createPMGraph(appConfig, cp),
    toInput: (query) => ({ goal: query }),
    toResult: (v) => ({ answer: v.output ?? "" }),
    checkpointer: durableCheckpointer(appConfig, opts.checkpointer),
    appConfig,
  });
}
