/**
 * 人审定稿示例（human-in-loop）——【图逻辑已提升至 src/libs/topologies/human-in-loop】。
 *
 * 本文件保留 example 的 createReviewFlow（StatefulFlow 包装）：examples 在 src 外、可自由 import
 * surfaces 的 createStatefulFlow；图构造委托拓扑的 createReviewGraph（单一权威，零重复）。
 *
 *   START → compose → present_review(MCP，可选) → review(interrupt) → finalize → END
 * 拓扑节点/反射/recipe 见 src/libs/topologies/human-in-loop/。
 */
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import { durableCheckpointer } from "../../src/runtime/services/file-checkpoint-saver.js";
import {
  createReviewGraph,
  getReviewTopology,
  type ReviewStateType,
} from "../../src/libs/topologies/human-in-loop/index.js";
import type { StatefulFlow } from "../../src/core/flow-types.js";
import type { AppConfig } from "../../src/runtime/index.js";
import type { StructuredTool } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

export { getReviewTopology };

/**
 * 包装成模板 StatefulFlow：run({query})→跑到 review 的 interrupt；run({resume})→finalize。
 * 经 createStatefulFlow 统一 run-loop + 持久化 resume；checkpointer 默认 FileCheckpointSaver
 * （durableCheckpointer），两次调用/重启之间草稿不丢。单测可注入 MemorySaver。
 */
export function createReviewFlow(
  appConfig?: AppConfig,
  opts: {
    checkpointer?: BaseCheckpointSaver;
    askQuestionTool?: StructuredTool;
  } = {}
): StatefulFlow {
  return createStatefulFlow<ReviewStateType>({
    buildGraph: (cp) =>
      createReviewGraph(appConfig, cp, undefined, opts.askQuestionTool),
    toInput: (query) => ({ query }),
    toResult: (v) => ({ answer: v.output ?? "" }),
    checkpointer: durableCheckpointer(appConfig, opts.checkpointer),
    appConfig,
  });
}
