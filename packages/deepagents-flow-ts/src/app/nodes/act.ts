/**
 * act 节点 ——【模式:工具调用节点 + onToolCall 透出】。
 *
 * 执行 plan 选定的工具,并把"工具调用过程"经 onToolCall 回调通知 surface
 * (→ ACP tool_call 卡片,见 src/surfaces/acp/server.ts 的 emitToolCall)。
 * 工具结果先放 pendingResult,由 observe 节点整理进 observations[]。
 *
 * 这是「工具节点」样板:发 in_progress → 执行 → 发 completed/failed。
 * 真实模板里把 runDemoTool 换成你的工具调度(MCP / API);onToolCall 透出方式不变。
 */

import { randomUUID } from "node:crypto";
import type { FlowState } from "../state.js";
import type { ToolCallEvent } from "../../surfaces/flow-types.js";
import { runDemoTool } from "./tools.js";

export async function actNode(
  state: FlowState,
  onToolCall?: (e: ToolCallEvent) => void | Promise<void>
): Promise<Partial<FlowState>> {
  const plan = state.plan;
  if (!plan) {
    return { pendingResult: null };
  }

  const toolCallId = onToolCall ? randomUUID() : "";
  const args = plan.args ?? {};

  if (onToolCall) {
    await onToolCall({ toolCallId, toolName: plan.tool, args, status: "in_progress" });
  }

  let result: string;
  let status: "completed" | "failed";
  try {
    result = runDemoTool(plan.tool, args);
    status = "completed";
  } catch (err) {
    result = err instanceof Error ? err.message : String(err);
    status = "failed";
  }

  if (onToolCall) {
    await onToolCall({
      toolCallId,
      toolName: plan.tool,
      args,
      status,
      ...(status === "completed" ? { result } : { error: result }),
    });
  }

  return {
    pendingResult: { tool: plan.tool, args, result },
    steps: [...(state.steps ?? []), `act: ${plan.tool} → ${result}`],
  };
}
