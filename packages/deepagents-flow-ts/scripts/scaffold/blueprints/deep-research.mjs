/**
 * blueprint: deep-research —— 长任务多阶段 + 持续会话（stateful）。
 *
 *   clarify → plan → outline_gate →(Send) research → review → draft → converse ↔ respond → delivery
 * 适合：深度研究报告、多源调研 + 撰写 + 多轮追问改稿的长任务。
 * 图逻辑单一权威在 src/libs/topologies/deep-research/；本 blueprint 只生成薄封装绑 spec。
 *
 * spec.systemPrompt 不注入：deep-research 是多阶段领域 prompt（clarify/plan/research/draft/converse），
 * 通用 persona 不适配多阶段研究范式。
 * ⚠️ research 真实联网（Context7 MCP），需 npx + 网络 + 模型凭证。
 */

/** 拓扑 kind。 */
export const kind = "stateful-recipe";

/** @param {{name:string,description:string,systemPrompt:string}} spec */
export function render(spec) {
  const content = `/**
 * ${spec.name} — deep-research 拓扑（scaffold 生成，可手改）
 * ${spec.description || "长任务多阶段研究：clarify → plan → research → draft → converse"}
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
`;
  return [{ path: `src/app/flows/${spec.name}/index.ts`, content }];
}
