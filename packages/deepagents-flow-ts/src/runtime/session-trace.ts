/**
 * 会话调试 trace —— 与 app 业务节点解耦。
 *
 * 在 surface / executor 边界注入：包装 FlowCallbacks、包裹一次 flow 运行的生命周期日志。
 * 业务节点（think / tools / respond）不直接打 trace，经 onToolCall / onToken 透出即可。
 *
 * LLM 调用耗时与重试见 runtime/services/llm-resilience.ts（基础设施层）。
 */

import type { FlowCallbacks, ToolCallEvent } from "../core/flow-types.js";
import {
  logger,
  truncateForLog,
  formatPayloadForLog,
  formatMessagesForLog,
} from "./logger.js";

const log = logger.child("session-trace");

/** trace 上下文（可选 session / thread 标识）。 */
export interface SessionTraceContext {
  sessionId?: string;
  threadId?: string;
}

function traceToolCallEvent(e: ToolCallEvent): void {
  if (e.status === "in_progress") {
    log.debug("tool invoke start", {
      toolName: e.toolName,
      toolCallId: e.toolCallId,
    });
    log.block("debug", `tool ${e.toolName} args`, formatPayloadForLog(e.args));
    return;
  }
  if (e.status === "completed") {
    const text = typeof e.result === "string" ? e.result : JSON.stringify(e.result ?? "");
    log.debug("tool invoke done", {
      toolName: e.toolName,
      toolCallId: e.toolCallId,
      resultChars: text.length,
    });
    log.block("debug", `tool ${e.toolName} result`, formatPayloadForLog(text));
    return;
  }
  log.debug("tool invoke failed", {
    toolName: e.toolName,
    toolCallId: e.toolCallId,
    error: e.error,
  });
  if (e.error) {
    log.block("debug", `tool ${e.toolName} error`, formatPayloadForLog(e.error));
  }
}

/**
 * 包装 FlowCallbacks：在原有回调前后写 tool/token trace，不改变业务语义。
 * 即使调用方未传 onToolCall，也会记录工具三态（供无 ACP UI 的 CLI 调试）。
 */
export function traceFlowCallbacks(
  callbacks: FlowCallbacks = {},
  ctx?: SessionTraceContext
): FlowCallbacks {
  return {
    ...callbacks,
    onToken: async (token) => callbacks.onToken?.(token),
    onToolCall: async (e) => {
      traceToolCallEvent(e);
      await callbacks.onToolCall?.(e);
    },
    onStage: callbacks.onStage
      ? async (e) => {
          log.debug("stage", {
            stage: e.stage,
            index: e.index,
            total: e.total,
            threadId: ctx?.threadId,
            sessionId: ctx?.sessionId,
          });
          return callbacks.onStage!(e);
        }
      : undefined,
    onPlan: callbacks.onPlan,
    signal: callbacks.signal,
  };
}

export interface TraceFlowRunMeta {
  input?: string;
  sessionId?: string;
  threadId?: string;
  mode?: string;
  [key: string]: unknown;
}

/**
 * 包裹一次 flow 执行：start / done / 耗时 / 可选 messages 快照。
 * 用于 default-flow executor、stateful-flow.run 等边界，不侵入图节点。
 */
export async function traceFlowRun<T extends {
  output?: string;
  answer?: string;
  steps?: string[];
  messages?: Array<{ _getType?: () => string; content?: unknown; tool_calls?: unknown }>;
  status?: string;
  footer?: string;
}>(
  label: string,
  meta: TraceFlowRunMeta,
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  const inputText = meta.input ?? "";
  log.info(`${label} start`, {
    ...meta,
    input: inputText ? truncateForLog(inputText, 200) : undefined,
    inputChars: inputText.length,
  });
  try {
    const result = await fn();
    const answer = result.output ?? result.answer ?? "";
    log.info(`${label} done`, {
      ...meta,
      durationMs: Date.now() - startedAt,
      status: result.status,
      outputChars: answer.length,
      footerChars: result.footer?.length ?? 0,
      steps: result.steps,
    });
    if (result.messages?.length) {
      log.block("debug", `${label} messages`, formatMessagesForLog(result.messages));
    } else if (answer) {
      log.debug(`${label} output preview`, {
        outputChars: answer.length,
        preview: truncateForLog(answer, 200),
      });
    }
    return result;
  } catch (err) {
    log.error(`${label} failed`, {
      ...meta,
      durationMs: Date.now() - startedAt,
      error: String(err),
    });
    throw err;
  }
}
