/**
 * blueprint: project-manager —— reflection 评估循环 + HITL 审批。
 *
 *   plan → estimate → evaluate →(cond 不完备&未达上限→plan) | approve(interrupt) → finalize
 * 适合：目标拆解、项目规划、带评审重做 + 人审的任务流。
 * 图逻辑单一权威在 src/libs/topologies/project-manager/；本 blueprint 只生成薄封装绑 spec。
 *
 * systemPrompt 注入主节点 plan（角色开场）；多 LLM 节点（estimate/evaluate/finalize）领域默认。
 */

/** 拓扑 kind。 */
export const kind = "stateful-recipe";

/** @param {{name:string,description:string,systemPrompt:string}} spec */
export function render(spec) {
  const fallback = spec.systemPrompt ? JSON.stringify(spec.systemPrompt) : "undefined";
  const content = `/**
 * ${spec.name} — project-manager 拓扑（scaffold 生成，可手改）
 * ${spec.description || "reflection 评估循环 + HITL 审批：plan → estimate → evaluate → approve → finalize"}
 *
 * 图逻辑单一权威在 src/libs/topologies/project-manager/；本文件只绑 spec。
 * systemPrompt 注入 plan 节点角色开场（其余 LLM 节点领域默认）。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../../../libs/topologies/types.js";
import { pmRecipe, getPMTopology } from "../../../libs/topologies/project-manager/index.js";

const FALLBACK_SYSTEM_PROMPT = ${fallback};

// as StatefulTopologyRecipe：边界处擦除具体 state 泛型（见 human-in-loop blueprint 同理注释）。
export const recipe = (runtime: FlowRuntime): StatefulTopologyRecipe =>
  pmRecipe(runtime, {
    systemPrompt: FALLBACK_SYSTEM_PROMPT,
  }) as StatefulTopologyRecipe;

export const getTopology = () => getPMTopology();
`;
  return [{ path: `src/app/flows/${spec.name}/index.ts`, content }];
}
