/**
 * 会话调试 trace —— 与 app 业务节点解耦。
 *
 * ACP 路径：`runInAcpPromptCycle` 在 onPrompt 周期内设置 AsyncLocalStorage，
 * 周期内 tool/stage/LLM 日志自动带 sessionId + promptMs。
 * CLI 路径：surfaces/cli/run.ts 在调用 flow 前包 `traceFlowRun` / `traceFlowCallbacks`。
 * 业务图（stateful-flow / default-flow）不感知 trace。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { FlowCallbacks, ToolCallEvent } from "../core/flow-types.js";
import {
  logger,
  truncateForLog,
  formatPayloadForLog,
  formatMessagesForLog,
  getEffectiveLogLevel,
} from "./logger.js";

const log = logger.child("session-trace");

/** 单次 ACP onPrompt 调用周期上下文（AsyncLocalStorage）。 */
export interface AcpPromptCycle {
  sessionId: string;
  startedAt: number;
  /** query | resume */
  mode?: string;
  query?: string;
}

const acpPromptStore = new AsyncLocalStorage<AcpPromptCycle>();

/** 是否处于 ACP onPrompt 周期内（executor 层据此跳过重复 trace 包装）。 */
export function isInAcpPromptCycle(): boolean {
  return acpPromptStore.getStore() != null;
}

/** 当前 ACP 周期（无则 undefined）。 */
export function getAcpPromptCycle(): AcpPromptCycle | undefined {
  return acpPromptStore.getStore();
}

/** 供 session-trace / llm-resilience 附带的周期字段。 */
export function acpPromptLogFields(extra?: Record<string, unknown>): Record<string, unknown> {
  const cycle = getAcpPromptCycle();
  if (!cycle) return extra ?? {};
  return {
    sessionId: cycle.sessionId,
    promptMs: Date.now() - cycle.startedAt,
    ...(cycle.mode ? { mode: cycle.mode } : {}),
    ...extra,
  };
}

/**
 * 在 ACP onPrompt 周期内执行 fn；周期内所有 trace 自动关联 sessionId。
 * 由 surfaces/acp/server.ts 在 onPrompt 入口调用。
 */
export function runInAcpPromptCycle<T>(
  cycle: AcpPromptCycle,
  fn: () => Promise<T>
): Promise<T> {
  return acpPromptStore.run(cycle, fn);
}

/** trace 上下文（CLI 等非 ACP 路径可显式传 threadId）。 */
export interface SessionTraceContext {
  sessionId?: string;
  threadId?: string;
}

function resolveSessionId(ctx?: SessionTraceContext): string | undefined {
  return getAcpPromptCycle()?.sessionId ?? ctx?.sessionId ?? ctx?.threadId;
}

function traceToolCallEvent(e: ToolCallEvent, ctx?: SessionTraceContext): void {
  const base = acpPromptLogFields({
    toolName: e.toolName,
    toolCallId: e.toolCallId,
    sessionId: resolveSessionId(ctx),
  });
  if (e.status === "in_progress") {
    log.debug("tool invoke start", base);
    log.block("debug", `tool ${e.toolName} args`, formatPayloadForLog(e.args));
    return;
  }
  if (e.status === "completed") {
    const text = typeof e.result === "string" ? e.result : JSON.stringify(e.result ?? "");
    log.debug("tool invoke done", { ...base, resultChars: text.length });
    log.block("debug", `tool ${e.toolName} result`, formatPayloadForLog(text));
    return;
  }
  log.debug("tool invoke failed", { ...base, error: e.error });
  if (e.error) {
    log.block("debug", `tool ${e.toolName} error`, formatPayloadForLog(e.error));
  }
}

/**
 * 包装 FlowCallbacks：在原有回调前后写 tool/stage trace。
 * ACP 周期内由 server 包一层；CLI 由 stateful-flow 包一层。
 */
export function traceFlowCallbacks(
  callbacks: FlowCallbacks = {},
  ctx?: SessionTraceContext
): FlowCallbacks {
  return {
    ...callbacks,
    onToken: async (token, source) => callbacks.onToken?.(token, source),
    onToolCall: async (e) => {
      traceToolCallEvent(e, ctx);
      await callbacks.onToolCall?.(e);
    },
    onStage: callbacks.onStage
      ? async (e) => {
          log.debug(
            "stage",
            acpPromptLogFields({
              stage: e.stage,
              index: e.index,
              total: e.total,
              sessionId: resolveSessionId(ctx),
              threadId: ctx?.threadId,
            })
          );
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

function compactMeta(meta: TraceFlowRunMeta): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * 包裹一次 flow 执行（由 surface 层调用：ACP server / CLI）。
 */
export async function traceFlowRun<T extends {
  output?: string;
  answer?: string;
  question?: string;
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
  const cycleFields = acpPromptLogFields();
  log.info(`${label} start`, {
    ...compactMeta(meta),
    ...cycleFields,
    input: inputText ? truncateForLog(inputText, 200) : undefined,
    inputChars: inputText.length,
  });
  try {
    const result = await fn();
    const answer = result.output ?? result.answer ?? "";
    const doneMeta: Record<string, unknown> = {
      ...compactMeta(meta),
      ...acpPromptLogFields(),
      durationMs: Date.now() - startedAt,
      flowStatus: result.status,
      outputChars: answer.length,
      footerChars: result.footer?.length ?? 0,
    };
    if (result.steps?.length) doneMeta.steps = result.steps;
    if (result.status === "interrupted" && result.question) {
      doneMeta.questionChars = result.question.length;
    }
    log.info(`${label} done`, doneMeta);
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
      ...compactMeta(meta),
      ...acpPromptLogFields(),
      durationMs: Date.now() - startedAt,
      error: String(err),
    });
    throw err;
  }
}

/** ACP session/prompt 周期起止（仅 surfaces/acp/server.ts 调用）。 */

/** 协议收到 session/prompt，onPrompt 入口。 */
export function logAcpPromptStart(meta: {
  sessionId: string;
  query: string;
  mode?: string;
  resuming?: boolean;
  isStateful?: boolean;
}): void {
  const logQuery =
    getEffectiveLogLevel() === "debug" ? meta.query : truncateForLog(meta.query, 200);
  log.info("prompt_start", {
    sessionId: meta.sessionId,
    ...(meta.mode ? { mode: meta.mode } : {}),
    ...(meta.resuming != null ? { resuming: meta.resuming } : {}),
    ...(meta.isStateful != null ? { isStateful: meta.isStateful } : {}),
    query: logQuery,
    queryChars: meta.query.length,
    promptMs: 0,
  });
}

/** onPrompt 即将 return { stopReason } 给 deepagents-acp。 */
export function logAcpPromptEnd(meta: {
  sessionId: string;
  startedAt: number;
  /** ACP 协议返回给客户端的 stopReason（end_turn / cancelled / …）。 */
  stopReason: string;
  /** flow 内部状态（interrupted / done），与 stopReason 不同：HITL interrupt 仍返回 end_turn。 */
  flowStatus?: string;
  answerChars?: number;
  questionChars?: number;
  streamed?: boolean;
  streamChars?: number;
  tokenChunks?: number;
  error?: string;
}): void {
  const fields: Record<string, unknown> = {
    sessionId: meta.sessionId,
    promptMs: Date.now() - meta.startedAt,
    stopReason: meta.stopReason,
  };
  if (meta.flowStatus) fields.flowStatus = meta.flowStatus;
  if (meta.answerChars != null) fields.answerChars = meta.answerChars;
  if (meta.questionChars != null) fields.questionChars = meta.questionChars;
  if (meta.streamed != null) fields.streamed = meta.streamed;
  if (meta.streamChars != null) fields.streamChars = meta.streamChars;
  if (meta.tokenChunks != null) fields.tokenChunks = meta.tokenChunks;
  if (meta.error) fields.error = meta.error;
  const level = meta.error ? "error" : "info";
  log[level](`prompt_end ${meta.stopReason}`, fields);
}

/** deepagents-acp 在 turn 收尾后回调（协议层确认）。 */
export function logPromptComplete(meta: {
  sessionId: string;
  stopReason: string;
  promptMs: number;
}): void {
  log.info(`prompt_complete ${meta.stopReason}`, {
    sessionId: meta.sessionId,
    stopReason: meta.stopReason,
    promptMs: meta.promptMs,
  });
}
