/**
 * coding-agent — dev-agent 拓扑（scaffold 生成，可手改）
 * 综合编码助手：ReAct 工具调用 + 多轮续接 + 上下文压缩（stateful-custom）
 *
 * 图逻辑单一权威在 src/app/topologies/dev-agent.ts；本文件只绑 spec。
 * 注：dev-agent 复用默认 ReAct 图，系统提示词经 runtime.systemPrompt（ACP/config 注入）；
 * spec.systemPrompt 不直接注入（与默认图同一通道）。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulFlow } from "../../../core/flow-types.js";
import {
  createDevAgentFlow,
  getDevAgentTopology,
} from "../../topologies/dev-agent.js";

export const createExecutor = (runtime: FlowRuntime): StatefulFlow =>
  createDevAgentFlow(runtime);

export const getTopology = () => getDevAgentTopology();
