/**
 * LLM 调用韧性 —— 模板级共用（默认 ReAct 图、compaction、长任务示例）。
 *
 * 从 deep-research 实战反哺的能力：
 *  - 超时护栏：慢模型（如 mimo-v2.5-pro）+ Send 并行时单次 invoke 易 >60s
 *  - 指数退避重试：限流 429 / 网络抖动不应直接掐死整条流水线
 *  - 并发闸门：并行扇出时避免 N 路同时打满上游 API（搜索侧 rateLimited，LLM 侧需单独限流）
 *
 * 超时/并发可通过 env 或 config.model.settings 覆盖：
 *   LLM_TIMEOUT_MS / model.settings.invokeTimeoutMs
 *   LLM_LONG_TIMEOUT_MS / model.settings.invokeLongTimeoutMs
 *   LLM_MAX_CONCURRENT / model.settings.maxConcurrentInvokes
 */

import type { BaseMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "../vendor/runtime/index.js";

const log = logger.child("llm-resilience");

/** 短调用默认超时（plan / review / think / 章节摘要）。实测 60s 对慢模型偏紧。 */
export const LLM_TIMEOUT_SHORT_MS = 120_000;
/** 长调用默认超时（draft / respond / compaction 摘要）。 */
export const LLM_TIMEOUT_LONG_MS = 180_000;
/** Send 并行或高负载时 LLM 默认最大并发。 */
export const LLM_DEFAULT_MAX_CONCURRENT = 2;

export interface LlmResilienceSettings {
  shortTimeoutMs: number;
  longTimeoutMs: number;
  maxConcurrent: number;
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * 合并 env + AppConfig 得到 LLM 韧性参数（env 经 config loader 写入 settings 后与此一致）。
 */
export function resolveLlmResilience(config?: AppConfig): LlmResilienceSettings {
  const settings = config?.model?.settings as
    | {
        invokeTimeoutMs?: number;
        invokeLongTimeoutMs?: number;
        maxConcurrentInvokes?: number;
      }
    | undefined;

  return {
    shortTimeoutMs:
      settings?.invokeTimeoutMs ??
      parsePositiveInt(process.env.LLM_TIMEOUT_MS) ??
      LLM_TIMEOUT_SHORT_MS,
    longTimeoutMs:
      settings?.invokeLongTimeoutMs ??
      parsePositiveInt(process.env.LLM_LONG_TIMEOUT_MS) ??
      LLM_TIMEOUT_LONG_MS,
    maxConcurrent:
      settings?.maxConcurrentInvokes ??
      parsePositiveInt(process.env.LLM_MAX_CONCURRENT) ??
      LLM_DEFAULT_MAX_CONCURRENT,
  };
}

/**
 * 单步 Promise 超时护栏。超时 reject，由调用方或 invokeWithResilience 决定重试/降级。
 */
export async function withTimeout<T>(p: Promise<T>, ms: number, label = "操作"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}超时（${ms}ms）`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 指数退避重试。重试用尽仍失败才抛，交调用方降级。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 800;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        log.warn(`${opts.label ?? "LLM"}失败，重试 ${i + 1}/${attempts - 1}`, {
          error: String(err),
        });
        await new Promise((r) => setTimeout(r, base * 2 ** i));
      }
    }
  }
  throw lastErr;
}

/**
 * 信号量式并发限制器——超出 maxConcurrent 的调用 FIFO 排队。
 * fn 抛错也会 release 槽位。
 */
export function createConcurrencyLimiter(maxConcurrent: number) {
  if (maxConcurrent < 1) {
    throw new Error("createConcurrencyLimiter: maxConcurrent 至少为 1");
  }
  let active = 0;
  const waiters: Array<() => void> = [];

  const acquire = (): Promise<void> =>
    new Promise((resolve) => {
      if (active < maxConcurrent) {
        active++;
        resolve();
      } else {
        waiters.push(() => {
          active++;
          resolve();
        });
      }
    });

  const release = (): void => {
    active--;
    const next = waiters.shift();
    if (next) next();
  };

  return async function limited<T>(fn: () => Promise<T>): Promise<T> {
    await acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

/** 按 config/env 惰性创建的全局 LLM 并发闸门（默认图 + compaction + 示例可共用）。 */
let sharedLimiter: {
  max: number;
  limit: ReturnType<typeof createConcurrencyLimiter>;
} | null = null;

export function getSharedLlmLimiter(config?: AppConfig): ReturnType<typeof createConcurrencyLimiter> {
  const { maxConcurrent } = resolveLlmResilience(config);
  if (!sharedLimiter || sharedLimiter.max !== maxConcurrent) {
    sharedLimiter = {
      max: maxConcurrent,
      limit: createConcurrencyLimiter(maxConcurrent),
    };
  }
  return sharedLimiter.limit;
}

export interface InvokeWithResilienceOptions {
  /** 单次 invoke 超时（毫秒）。 */
  timeoutMs?: number;
  /** 超时错误文案前缀。 */
  label?: string;
  /** 重试次数（默认 3）。 */
  attempts?: number;
  /** 重试日志前缀。 */
  retryLabel?: string;
  /** 重试基础退避（毫秒）。 */
  baseDelayMs?: number;
  /**
   * 是否经共享并发闸门排队。
   * 默认图 think 为串行可 false；Send 扇出并行示例应 true。
   */
  useSharedLimiter?: boolean;
  /** useSharedLimiter 时用于解析并发上限的 config。 */
  config?: AppConfig;
}

type InvokeModel = { invoke: (messages: BaseMessage[]) => Promise<{ content: unknown }> };

/**
 * 标准 LLM 调用链：可选并发闸门 → 超时 → 重试。
 * 默认图、compaction、长任务示例节点统一经此入口，避免各处复制护栏逻辑。
 */
export function invokeWithResilience<M extends InvokeModel>(
  model: M,
  messages: BaseMessage[],
  options: InvokeWithResilienceOptions = {}
): Promise<Awaited<ReturnType<M["invoke"]>>> {
  const resilience = resolveLlmResilience(options.config);
  const timeoutMs = options.timeoutMs ?? resilience.shortTimeoutMs;
  const label = options.label ?? "LLM 调模型";
  const run = () =>
    withRetry(
      () => withTimeout(model.invoke(messages), timeoutMs, label),
      {
        attempts: options.attempts,
        baseDelayMs: options.baseDelayMs,
        label: options.retryLabel ?? label,
      }
    ) as Promise<Awaited<ReturnType<M["invoke"]>>>;

  if (options.useSharedLimiter) {
    return getSharedLlmLimiter(options.config)(run);
  }
  return run();
}
