/**
 * 测试用 recipe 物化：把 libs 的 graph 构造 + surfaces createStatefulFlow 拧成可跑 StatefulFlow。
 * 产品路径走组合根 materializeFlow；单测不经 app/flows 注册表，直接测拓扑语义。
 */
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { AppConfig } from "../../src/runtime/index.js";
import type { StatefulFlow } from "../../src/core/flow-types.js";
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import { durableCheckpointer } from "../../src/runtime/services/file-checkpoint-saver.js";
import type { StatefulTopologyRecipe } from "../../src/libs/topologies/types.js";

/** 将 StatefulTopologyRecipe 物化为 StatefulFlow（注入 checkpointer + appConfig）。 */
export function materializeRecipe<S>(
  recipe: StatefulTopologyRecipe<S>,
  appConfig?: AppConfig,
  checkpointer?: BaseCheckpointSaver
): StatefulFlow {
  return createStatefulFlow<S>({
    ...recipe,
    checkpointer: durableCheckpointer(appConfig, checkpointer),
    appConfig,
  });
}
