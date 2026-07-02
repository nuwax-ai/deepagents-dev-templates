/**
 * blueprint: human-in-loop —— MCP 可选展示 + interrupt（compose → present_review → review → finalize）。
 *
 * 适合：内容审阅定稿、审批、校对、可控生成（生成 → 人审 → 按意见定稿）。
 * 图逻辑单一权威在 src/libs/topologies/human-in-loop/；本 blueprint 只生成薄封装绑 spec。
 *
 * 生成 stateful-recipe 形态的 FlowDef：导出 recipe + getTopology；createStatefulFlow 包装
 * 由组合根 index.ts 的 materializeFlow 完成（规避 app/libs → surfaces 分层违规）。
 *
 * systemPrompt 注入到 compose 节点（主 LLM 节点）；spec.systemPrompt（场景）优先，spec 空时
 * 图用领域默认（DEFAULT_COMPOSE_PROMPT）。不混入 runtime.systemPrompt（框架 prompt 恒非空会
 * 覆盖领域默认；场景节点应只用 scene/领域 prompt）。

/** 拓扑 kind（FlowDef discriminated union 的判别字段）。 */
export const kind = "stateful-recipe";

/** @param {{name:string,description:string,systemPrompt:string}} spec */
export function render(spec) {
  const fallback = spec.systemPrompt ? JSON.stringify(spec.systemPrompt) : "undefined";
  const content = `/**
 * ${spec.name} — human-in-loop 拓扑（scaffold 生成，可手改）
 * ${spec.description || "MCP 可选展示 + interrupt：compose → present_review → review(interrupt) → finalize"}
 *
 * 图逻辑单一权威在 src/libs/topologies/human-in-loop/；本文件只绑 spec。
 * systemPrompt 注入 compose 节点（spec 场景优先；spec 空时图用领域默认 DEFAULT_COMPOSE_PROMPT）。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../../../libs/topologies/types.js";
import {
  reviewRecipe,
  getReviewTopology,
} from "../../../libs/topologies/human-in-loop/index.js";

/** compose 节点场景系统提示词（spec.systemPrompt）；spec 空时为 undefined，图回退领域默认。 */
const FALLBACK_SYSTEM_PROMPT = ${fallback};

// as StatefulTopologyRecipe：边界处擦除具体 state 泛型（注册表/createStatefulFlow 都是泛型，
// 不携带具体 ReviewStateType；toResult 在 S 上逆变，具体类型不能直接赋 Record，故擦除）。
export const recipe = (runtime: FlowRuntime): StatefulTopologyRecipe =>
  reviewRecipe(runtime, {
    systemPrompt: FALLBACK_SYSTEM_PROMPT,
  }) as StatefulTopologyRecipe;

export const getTopology = () => getReviewTopology();
`;
  return [{ path: `src/app/flows/${spec.name}/index.ts`, content }];
}
