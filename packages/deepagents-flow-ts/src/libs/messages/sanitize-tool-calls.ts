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
  const raw = msg as unknown as Record<string, unknown>;
  const top = raw.tool_calls;
  if (Array.isArray(top) && top.length > 0) {
    return top as Array<{ id?: string; name: string; args: Record<string, unknown> }>;
  }
  // checkpoint 反序列化后可能只剩 additional_kwargs.tool_calls
  const kwargs = raw.additional_kwargs as Record<string, unknown> | undefined;
  const nested = kwargs?.tool_calls;
  return Array.isArray(nested)
    ? (nested as Array<{ id?: string; name: string; args: Record<string, unknown> }>)
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
 *
 * 同时清除 additional_kwargs.tool_calls：OpenAI converter 会在顶层 tool_calls
 * 为空时回退序列化 kwargs，否则仍会触发 INVALID_TOOL_RESULTS。
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
    // 拷贝后删掉 tool_calls，避免把孤立 call 经 OpenAI fallback 再发出去
    const additionalKwargs = raw.additional_kwargs
      ? { ...(raw.additional_kwargs as Record<string, unknown>) }
      : undefined;
    if (additionalKwargs) {
      delete additionalKwargs.tool_calls;
    }
    return new AIMessage({
      content: (raw.content as string | undefined) ?? "",
      additional_kwargs:
        additionalKwargs && Object.keys(additionalKwargs).length > 0
          ? additionalKwargs
          : undefined,
      // 显式 []：避免 undefined 时 AIMessage 从 additional_kwargs 再解析
      tool_calls: valid as AIMessage["tool_calls"],
      id: typeof raw.id === "string" ? raw.id : undefined,
      name: typeof raw.name === "string" ? raw.name : undefined,
    });
  });
}
