/**
 * 会话调试 trace —— 与 app 业务节点解耦。
 *
 * ACP 路径：`runInAcpPromptCycle` 在 onPrompt 周期内设置 AsyncLocalStorage，
 * 周期内 tool/stage/LLM 日志自动带 sessionId + promptMs。
 * CLI 路径：stateful-flow / default-flow 自行 `traceFlowRun`（无 ACP 周期时）。
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
    onToken: async (token) => callbacks.onToken?.(token),
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
 * 包裹一次 flow 执行（CLI / 非 ACP 路径）。
 * 已在 ACP onPrompt 周期内时仅执行 fn，避免与 acp-prompt 周期日志重复。
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
  const inAcp = isInAcpPromptCycle();
  const startedAt = Date.now();
  const inputText = meta.input ?? "";
  if (!inAcp) {
    log.info(`${label} start`, {
      ...compactMeta(meta),
      input: inputText ? truncateForLog(inputText, 200) : undefined,
      inputChars: inputText.length,
    });
  }
  try {
    const result = await fn();
    if (!inAcp) {
      const answer = result.output ?? result.answer ?? "";
      const doneMeta: Record<string, unknown> = {
        ...compactMeta(meta),
        durationMs: Date.now() - startedAt,
        status: result.status,
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
    }
    return result;
  } catch (err) {
    if (!inAcp) {
      log.error(`${label} failed`, {
        ...compactMeta(meta),
        durationMs: Date.now() - startedAt,
        error: String(err),
      });
    }
    throw err;
  }
}

/** ACP onPrompt 周期起止日志（与 flow-acp 互补，带 promptMs 锚点）。 */
export function logAcpPromptStart(meta: {
  sessionId: string;
  mode: string;
  query: string;
  resuming?: boolean;
  isStateful?: boolean;
}): void {
  const logQuery =
    getEffectiveLogLevel() === "debug" ? meta.query : truncateForLog(meta.query, 200);
  log.info("acp-prompt ▶", {
    sessionId: meta.sessionId,
    mode: meta.mode,
    resuming: meta.resuming,
    isStateful: meta.isStateful,
    query: logQuery,
    queryChars: meta.query.length,
    promptMs: 0,
  });
}

export function logAcpPromptEnd(meta: {
  sessionId: string;
  startedAt: number;
  status?: string;
  answerChars?: number;
  questionChars?: number;
  streamed?: boolean;
  cancelled?: boolean;
  error?: string;
}): void {
  const fields: Record<string, unknown> = {
    sessionId: meta.sessionId,
    promptMs: Date.now() - meta.startedAt,
  };
  if (meta.status) fields.status = meta.status;
  if (meta.answerChars != null) fields.answerChars = meta.answerChars;
  if (meta.questionChars != null) fields.questionChars = meta.questionChars;
  if (meta.streamed != null) fields.streamed = meta.streamed;
  if (meta.cancelled) fields.cancelled = true;
  if (meta.error) fields.error = meta.error;
  const level = meta.error ? "error" : "info";
  const tag = meta.error ? "acp-prompt ✗" : meta.cancelled ? "acp-prompt ⊘" : "acp-prompt ◀";
  log[level](tag, fields);
}
