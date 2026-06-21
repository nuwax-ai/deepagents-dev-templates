/**
 * project-planner — project-manager 拓扑（scaffold 生成，可手改）
 * 项目规划：目标拆解 → 估时 → 评审重做 → 人审批定稿（stateful）
 *
 * 图逻辑单一权威在 src/libs/topologies/project-manager/；本文件只绑 spec。
 * systemPrompt 注入 plan 节点角色开场（其余 LLM 节点领域默认）。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../../../libs/topologies/types.js";
import { pmRecipe, getPMTopology } from "../../../libs/topologies/project-manager/index.js";

const FALLBACK_SYSTEM_PROMPT = "你是资深敏捷项目经理，擅长把模糊目标拆成有序、可执行、可验收的关键任务。";

// as StatefulTopologyRecipe：边界处擦除具体 state 泛型（见 human-in-loop blueprint 同理注释）。
export const recipe = (runtime: FlowRuntime): StatefulTopologyRecipe =>
  pmRecipe(runtime, {
    systemPrompt: FALLBACK_SYSTEM_PROMPT,
  }) as StatefulTopologyRecipe;

export const getTopology = () => getPMTopology();
