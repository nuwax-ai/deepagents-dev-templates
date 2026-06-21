/**
 * blueprint: travel-planner —— Map-reduce（Send 扇出）+ HITL。
 *
 *   gather → ⟨Send 并行⟩ research × 4（DDG 搜索）→ aggregate → confirm(interrupt) → finalize
 * 适合：多源信息聚合 + 人审确认的规划类任务（旅行、活动、采购方案）。
 * 图逻辑单一权威在 src/libs/topologies/travel-planner/；本 blueprint 只生成薄封装绑 spec。
 *
 * systemPrompt 注入主节点 aggregate（角色开场）；research/confirm/finalize 领域默认。
 * ⚠️ research 真实联网（DuckDuckGo MCP），需 npx + 网络。
 */

/** 拓扑 kind。 */
export const kind = "stateful-recipe";

/** @param {{name:string,description:string,systemPrompt:string}} spec */
export function render(spec) {
  const fallback = spec.systemPrompt ? JSON.stringify(spec.systemPrompt) : "undefined";
  const content = `/**
 * ${spec.name} — travel-planner 拓扑（scaffold 生成，可手改）
 * ${spec.description || "Map-reduce + HITL：gather → research×4 → aggregate → confirm → finalize"}
 *
 * 图逻辑单一权威在 src/libs/topologies/travel-planner/；本文件只绑 spec。
 * systemPrompt 注入 aggregate 节点角色开场。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../../../libs/topologies/types.js";
import { travelRecipe, getTravelTopology } from "../../../libs/topologies/travel-planner/index.js";

const FALLBACK_SYSTEM_PROMPT = ${fallback};

// as StatefulTopologyRecipe：边界处擦除具体 state 泛型。
export const recipe = (runtime: FlowRuntime): StatefulTopologyRecipe =>
  travelRecipe(runtime, {
    systemPrompt: FALLBACK_SYSTEM_PROMPT,
  }) as StatefulTopologyRecipe;

export const getTopology = () => getTravelTopology();
`;
  return [{ path: `src/app/flows/${spec.name}/index.ts`, content }];
}
