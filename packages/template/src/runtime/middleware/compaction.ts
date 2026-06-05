/**
 * Context Compaction Middleware
 *
 * Automatically compresses conversation history when context window
 * approaches capacity. Inspired by pi-mono's compaction system.
 *
 * Strategy:
 * - Monitor token usage via cost-tracking middleware
 * - When context exceeds threshold, summarize old messages via LLM
 * - Replace summarized messages with a compact summary entry
 * - Preserve recent messages (keepRecentTokens) intact
 *
 * This prevents long-running sessions from hitting context limits.
 */

import { createMiddleware, countTokensApproximately, HumanMessage } from "langchain";
import type { CompactionConfig } from "../config-loader.js";
import { logger } from "../logger.js";

export interface CompactionOptions {
  config: CompactionConfig;
  /** Model name for summary generation (e.g., "claude-sonnet-4-6") */
  modelName?: string;
}

interface CompactionState {
  hasCompacted: boolean;
  summaryText: string;
  compactedCount: number;
}

/**
 * Check if compaction should trigger based on current token usage.
 */
export function shouldCompact(
  contextTokens: number,
  contextWindow: number,
  triggerThreshold: number
): boolean {
  return contextTokens >= contextWindow * triggerThreshold;
}

/**
 * Find the cut point in messages: keep recent messages, summarize old ones.
 * Returns the index where compaction should start (0 = all messages).
 */
export function findCutPoint(
  messages: unknown[],
  keepRecentTokens: number
): number {
  if (messages.length === 0) return 0;

  // Walk backwards from end, accumulating tokens
  let tokenCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const msgTokens = countTokensApproximately([msg] as any[]);
    tokenCount += msgTokens;

    if (tokenCount >= keepRecentTokens) {
      // Found the cut point - don't split a turn (user/assistant pair)
      // Move back to the start of the current user message if we're mid-turn
      return Math.max(0, i);
    }
  }

  return 0;
}

/**
 * Generate a summary of old messages using the LLM.
 * In a real implementation, this would call the LLM.
 * For now, returns a placeholder summary.
 */
export async function generateSummary(
  _messages: unknown[],
  _modelName: string
): Promise<string> {
  // TODO: Implement LLM-based summarization
  // This would send the messages to the LLM with a summarization prompt
  // and return the generated summary.
  return "[Conversation history summarized - previous context compressed]";
}

/**
 * Create a compaction middleware that monitors and compresses context.
 */
export function createCompactionMiddleware(options: CompactionOptions) {
  const { config } = options;
  const log = logger.child("compaction");

  const state: CompactionState = {
    hasCompacted: false,
    summaryText: "",
    compactedCount: 0,
  };

  return createMiddleware({
    name: "compaction",

    beforeAgent: async () => {
      state.hasCompacted = false;
      state.summaryText = "";
      state.compactedCount = 0;
    },

    beforeModel: async (request) => {
      if (!config.enabled) return;

      const messages = request.messages ?? [];
      if (messages.length === 0) return;

      // Count current context tokens
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contextTokens = countTokensApproximately(messages as any[]);
      const threshold = config.contextWindow * config.triggerThreshold;

      log.debug("Context check", {
        tokens: contextTokens,
        threshold,
        window: config.contextWindow,
        messages: messages.length,
      });

      // Check if compaction needed
      if (!shouldCompact(contextTokens, config.contextWindow, config.triggerThreshold)) {
        return;
      }

      log.info("Triggering compaction", {
        tokens: contextTokens,
        threshold,
        messages: messages.length,
      });

      // Find cut point
      const cutIndex = findCutPoint(messages, config.keepRecentTokens);
      if (cutIndex === 0) {
        log.debug("No messages to compact (all within keepRecentTokens)");
        return;
      }

      // Messages to summarize
      const messagesToCompact = messages.slice(0, cutIndex);
      const messagesToKeep = messages.slice(cutIndex);

      try {
        // Generate summary (placeholder - would call LLM)
        const summary = await generateSummary(
          messagesToCompact,
          options.modelName ?? "claude-sonnet-4-6"
        );

        state.hasCompacted = true;
        state.summaryText = summary;
        state.compactedCount += messagesToCompact.length;

        log.info("Compaction complete", {
          compactedMessages: messagesToCompact.length,
          keptMessages: messagesToKeep.length,
          summaryLength: summary.length,
        });

        // Replace old messages with summary + keep recent messages
        return {
          messages: [
            new HumanMessage({
              content: `<compaction-summary>\n${summary}\n</compaction-summary>`,
            }),
            ...messagesToKeep,
          ],
        };
      } catch (err) {
        log.error("Compaction failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        // Don't modify messages on failure
        return;
      }
    },
  });
}
