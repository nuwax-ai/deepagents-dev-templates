/**
 * Cost Tracking Middleware
 *
 * Tracks token usage per turn and cumulatively. Logs token counts
 * after each model call for observability.
 *
 * Inspired by pydantic-deepagents' CostTracking capability.
 * Uses langchain's countTokensApproximately for estimation.
 */

import { createMiddleware, countTokensApproximately } from "langchain";
import { logger } from "../logger.js";

export interface CostTrackingOptions {
  /** Warn when cumulative tokens exceed this threshold. Default: 100000 */
  warnAtTokens?: number;
  /** Log level for per-turn tracking. Default: "debug" */
  logLevel?: "debug" | "info";
}

export interface TokenUsage {
  /** Total input tokens consumed */
  inputTokens: number;
  /** Total output tokens produced */
  outputTokens: number;
  /** Total tokens (input + output) */
  totalTokens: number;
  /** Number of model calls */
  modelCalls: number;
  /** Number of tool calls */
  toolCalls: number;
}

/**
 * Create a cost tracking middleware that logs token usage.
 *
 * Tracks approximate token counts using langchain's countTokensApproximately.
 * Logs cumulative usage after each model call.
 */
export function createCostTrackingMiddleware(options: CostTrackingOptions = {}) {
  const warnAt = options.warnAtTokens ?? 100_000;
  const logLevel = options.logLevel ?? "debug";

  const usage: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    modelCalls: 0,
    toolCalls: 0,
  };

  return createMiddleware({
    name: "costTracking",

    beforeAgent: async () => {
      // Reset per-run counters
      usage.inputTokens = 0;
      usage.outputTokens = 0;
      usage.totalTokens = 0;
      usage.modelCalls = 0;
      usage.toolCalls = 0;
    },

    wrapModelCall: async (request, handler) => {
      // Count input tokens before model call
      const messages = request.state?.messages ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputTokens = countTokensApproximately(messages as any[], request.tools as any[]);

      const response = await handler(request);

      // Count output tokens from the response
      const outputTokens = countTokensApproximately([response]);

      usage.inputTokens += inputTokens;
      usage.outputTokens += outputTokens;
      usage.totalTokens += inputTokens + outputTokens;
      usage.modelCalls++;

      const log = logger.child("cost-tracking");
      if (logLevel === "info") {
        log.info("Token usage", {
          turn: { input: inputTokens, output: outputTokens },
          cumulative: { total: usage.totalTokens, calls: usage.modelCalls },
        });
      } else {
        log.debug("Token usage", {
          turn: { input: inputTokens, output: outputTokens },
          cumulative: { total: usage.totalTokens, calls: usage.modelCalls },
        });
      }

      if (usage.totalTokens >= warnAt) {
        log.warn("Token budget threshold exceeded", {
          total: usage.totalTokens,
          threshold: warnAt,
        });
      }

      return response;
    },

    wrapToolCall: async (request, handler) => {
      usage.toolCalls++;
      return handler(request);
    },
  });
}
