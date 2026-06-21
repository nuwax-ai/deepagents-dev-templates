/**
 * research-agent — deep-research 拓扑（scaffold 生成，可手改）
 * 深度研究：主题确认 → 大纲规划 → 并行调研 → 评审 → 撰写报告 → 持续会话改稿（stateful）
 *
 * 图逻辑单一权威在 src/libs/topologies/deep-research/；本文件只绑 spec。
 * 注意：deep-research 多阶段领域 prompt，spec.systemPrompt 不注入。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../../../libs/topologies/types.js";
import { researchRecipe, getResearchTopology } from "../../../libs/topologies/deep-research/index.js";

// as StatefulTopologyRecipe：边界处擦除具体 state 泛型。
export const recipe = (runtime: FlowRuntime): StatefulTopologyRecipe =>
  researchRecipe(runtime) as StatefulTopologyRecipe;

export const getTopology = () => getResearchTopology();
