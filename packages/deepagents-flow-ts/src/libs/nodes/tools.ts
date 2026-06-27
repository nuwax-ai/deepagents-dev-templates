/**
 * createToolExecNode —— 执行 last AIMessage 的 tool_calls + 三态 onToolCall 透出
 * （in_progress → completed/failed）。默认图 tools 节点的泛化版（包 prebuilt ToolNode）。
 *
 * 也提供 runTool：执行单个工具 fn 并三态透出（供自定义工具节点 / MCP 检索节点用，
 * 如 examples 的 research/search 节点）。
 */

import { randomUUID } from "node:crypto";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { AIMessage, type BaseMessage, type ToolMessage } from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import type { FlowCallbacks, ToolCallEvent } from "../../core/flow-types.js";
import { normalizeToolResult } from "./tool-result-normalize.js";

/**
 * 执行一个工具 fn，并把过程经 onToolCall 三态透出。
 * MCP 有时返回 "Unknown tool: xxx" 但不抛错 —— 视为失败。
 * @returns { result, ok }
 */
export async function runTool(
  toolName: string,
  args: Record<string, unknown>,
  fn: () => string | Promise<string>,
  onToolCall?: (e: ToolCallEvent) => void | Promise<void>
): Promise<{ result: string; ok: boolean }> {
  const toolCallId = randomUUID();
  if (onToolCall) {
    await onToolCall({ toolCallId, toolName, args, status: "in_progress" });
  }
  try {
    const result = await fn();
    const unknownTool =
      typeof result === "string" && /^Unknown tool:/i.test(result.trim());
    if (unknownTool) {
      if (onToolCall) {
        await onToolCall({ toolCallId, toolName, args, status: "failed", error: result });
      }
      return { result, ok: false };
    }
    if (onToolCall) {
      await onToolCall({ toolCallId, toolName, args, status: "completed", result });
    }
    return { result, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (onToolCall) {
      await onToolCall({ toolCallId, toolName, args, status: "failed", error: message });
    }
    return { result: message, ok: false };
  }
}

export interface ToolExecNodeOptions<S extends { messages: BaseMessage[] }> {
  /** 可执行工具集（与 think 绑定同一组）。 */
  tools: StructuredTool[];
  /** surface 回调（透出工具调用事件）。 */
  callbacks?: FlowCallbacks;
  /** 把 ToolMessage[] 映射成 state 更新（默认 { messages }）。 */
  write?: (toolMsgs: ToolMessage[], state: S) => Partial<S>;
}

/**
 * 创建工具执行节点：实例化一次 ToolNode，执行前后透出 onToolCall 三态。
 * 默认返回 { messages }；默认图传 write 附带 steps。
 */
export function createToolExecNode<S extends { messages: BaseMessage[] }>(
  opts: ToolExecNodeOptions<S>
) {
  const { tools, callbacks, write } = opts;
  const toolNode = new ToolNode(tools);

  return async (state: S, config?: LangGraphRunnableConfig): Promise<Partial<S>> => {
    const onToolCall =
      (config?.configurable?.onToolCall as FlowCallbacks["onToolCall"]) ??
      callbacks?.onToolCall;
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const calls = (last?.tool_calls ?? []) as Array<{
      id?: string;
      name: string;
      args: Record<string, unknown>;
    }>;
    const argsById = new Map<string, Record<string, unknown>>();
    for (const c of calls) {
      if (onToolCall && c.id) {
        argsById.set(c.id, c.args);
        await onToolCall({
          toolCallId: c.id,
          toolName: c.name,
          args: c.args,
          status: "in_progress",
        });
      }
    }
    const result = (await toolNode.invoke({ messages: state.messages })) as {
      messages?: ToolMessage[];
    };
    const toolMsgs = result?.messages ?? [];
    for (const tm of toolMsgs) {
      if (onToolCall) {
        const failed = tm.status === "error";
        const normalized = normalizeToolResult(tm.content);
        const args = argsById.get(tm.tool_call_id) ?? {};
        // 保留 MCP structuredContent，供 emitToolCall 提取 ask-question 规范化 rawInput
        const result =
          normalized.rawOutput !== undefined
            ? {
                type: "text",
                text: normalized.text,
                structuredContent: normalized.rawOutput,
              }
            : normalized.text;
        await onToolCall({
          toolCallId: tm.tool_call_id,
          toolName: tm.name ?? "",
          args,
          status: failed ? "failed" : "completed",
          ...(failed ? { error: normalized.text } : { result }),
        });
      }
    }
    if (write) return write(toolMsgs, state);
    return { messages: toolMsgs } as unknown as Partial<S>;
  };
}
