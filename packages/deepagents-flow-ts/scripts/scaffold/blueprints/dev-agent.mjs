/**
 * blueprint: dev-agent —— 综合 ReAct + 多轮续接 + 上下文压缩（stateful-custom）。
 *
 *   prepare → think(bindTools) ↔ tools → respond（复用默认 ReAct 图），多轮同 threadId 续接 +
 *   applyCompaction 压缩长上下文。适合：带工具的编码/运维/综合助手（bash/文件/search/MCP）。
 *
 * 与其他拓扑不同：dev-agent 经**手写 run-loop**（非 createStatefulFlow），依赖 app/graph +
 * libs/compaction；权威实现落 src/app/flows/dev-agent/（app 层，stateful-custom）。
 * 系统提示词经 runtime.systemPrompt（ACP/config 注入），spec.systemPrompt 不直接注入。
 */

/** 拓扑 kind。 */
export const kind = "stateful-custom";

/** @param {{name:string,description:string,systemPrompt:string}} spec */
export function render(spec) {
  const content = `/**
 * ${spec.name} — dev-agent 拓扑（scaffold 生成，可手改）
 * ${spec.description || "综合 ReAct + 多轮续接 + 上下文压缩（stateful-custom）"}
 *
 * 图逻辑单一权威在 src/app/flows/dev-agent/；本文件只绑 spec。
 * 注：dev-agent 复用默认 ReAct 图，系统提示词经 runtime.systemPrompt（ACP/config 注入）；
 * spec.systemPrompt 不直接注入（与默认图同一通道）。
 * ⚠️ spec.name 禁止用 "dev-agent"（保留名，会覆盖内置 SSOT）；请用其它 kebab-case 如 coding-agent。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulFlow } from "../../../core/flow-types.js";
import {
  createDevAgentFlow,
  getDevAgentTopology,
} from "../dev-agent/index.js";

export const createExecutor = (runtime: FlowRuntime): StatefulFlow =>
  createDevAgentFlow(runtime);

export const getTopology = () => getDevAgentTopology();
`;
  return [{ path: `src/app/flows/${spec.name}/index.ts`, content }];
}
