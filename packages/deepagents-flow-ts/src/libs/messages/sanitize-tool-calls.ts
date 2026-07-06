/**
 * Checkpoint / 消息流中的孤立 tool_calls 清洗。
 *
 * LangGraph checkpoint 反序列化后消息常为 plain object（`type: "ai"`），
 * 不能用 instanceof AIMessage。think 调 LLM 前与 checkpoint 写回前共用本模块。
 */

import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { logger } from "../../runtime/logger.js";

const log = logger.child("checkpoint-messages");

/** 识别消息类型：类实例用 _getType()，反序列化对象用 type 字段。 */
export function msgType(msg: BaseMessage): string {
  const raw = msg as unknown as Record<string, unknown>;
  if (typeof raw._getType === "function") {
    return (raw._getType as () => string)();
  }
  return typeof raw.type === "string" ? raw.type : "";
}

export function msgToolCalls(
  msg: BaseMessage
): Array<{ id?: string; name: string; args: Record<string, unknown> }> {
  const raw = (msg as unknown as Record<string, unknown>).tool_calls;
  return Array.isArray(raw)
    ? (raw as Array<{ id?: string; name: string; args: Record<string, unknown> }>)
    : [];
}

export function msgToolCallId(msg: BaseMessage): string {
  const raw = (msg as unknown as Record<string, unknown>).tool_call_id;
  return typeof raw === "string" ? raw : "";
}

export function messageId(msg: BaseMessage): string | undefined {
  const raw = (msg as unknown as Record<string, unknown>).id;
  return typeof raw === "string" ? raw : undefined;
}

/** 收集缺少对应 ToolMessage 的 tool_call id。 */
export function findOrphanedToolCallIds(messages: BaseMessage[]): Set<string> {
  const toolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msgType(msg) === "tool" && msgToolCallId(msg)) {
      toolCallIds.add(msgToolCallId(msg));
    }
  }
  const orphaned = new Set<string>();
  for (const msg of messages) {
    if (msgType(msg) !== "ai") continue;
    for (const c of msgToolCalls(msg)) {
      if (c.id && !toolCallIds.has(c.id)) {
        orphaned.add(c.id);
      }
    }
  }
  return orphaned;
}

/**
 * 从 AIMessage 剥离孤立 tool_calls。
 * 无变更时返回原数组引用（便于调用方跳过写回）。
 */
export function sanitizeToolCalls(messages: BaseMessage[]): BaseMessage[] {
  const orphaned = findOrphanedToolCallIds(messages);
  if (orphaned.size === 0) return messages;
  log.warn("发现孤立 tool_calls，已移除", { orphanedCount: orphaned.size, ids: [...orphaned] });
  return messages.map((msg) => {
    if (msgType(msg) !== "ai") return msg;
    const raw = msg as unknown as Record<string, unknown>;
    const calls = msgToolCalls(msg);
    const valid = calls.filter((c) => !(c.id && orphaned.has(c.id)));
    if (valid.length === calls.length) return msg;
    return new AIMessage({
      content: (raw.content as string | undefined) ?? "",
      additional_kwargs: raw.additional_kwargs as Record<string, unknown> | undefined,
      tool_calls: valid.length > 0 ? (valid as AIMessage["tool_calls"]) : undefined,
      id: typeof raw.id === "string" ? raw.id : undefined,
      name: typeof raw.name === "string" ? raw.name : undefined,
    });
  });
}
