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
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { CompactionConfig } from "../config/config-loader.js";
import { logger } from "../logger.js";

export interface CompactionOptions {
  config: CompactionConfig;
  /** LLM used to generate summaries. When omitted, falls back to a deterministic placeholder. */
  summarizer?: BaseChatModel;
  /** Model name for log lines when summarizer is omitted. */
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

const SUMMARIZATION_PROMPT = `You are summarizing a conversation history that is about to be removed from the context window. The agent will continue working with only your summary plus the most recent messages.

Produce a structured summary in this exact format:

## Goal
The user's original goal or task.

## Key Context
- Decisions made
- Constraints discovered
- Important findings (file paths, function names, configuration keys, concrete values)

## Tool Usage
- Tools called and their outcomes
- Files created or modified (with paths)

## Open Questions / Unresolved
- Things the user still needs to decide
- Errors encountered but not yet resolved

## Current State
- Where the agent left off
- What the next step should be

Keep the summary under 1500 words. Be specific — include file paths, function names, configuration keys, and concrete values. Do not include pleasantries or filler.`;

/**
 * Convert an array of message-like objects into plain text for summarization.
 * Handles BaseMessage instances (from @langchain/core/messages) and plain
 * {role, content} objects (used in tests and across tool boundaries).
 */
function messagesToText(messages: unknown[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = msg as any;
    const role = m.role || m.type || "unknown";
    let content: string;
    if (typeof m.content === "string") {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      // MessageContent[] — extract text parts, drop image/binary blocks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content = m.content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
        .filter(Boolean)
        .join("\n");
    } else if (m.content == null) {
      content = "";
    } else {
      content = String(m.content);
    }
    const name = m.name ? ` (${m.name})` : "";
    parts.push(`[${role}${name}]: ${content}`);
  }
  return parts.join("\n\n");
}

function placeholderSummary(messages: unknown[], reason: string): string {
  return `[Conversation history summarized — ${messages.length} earlier messages compressed. ${reason}]`;
}

/**
 * Generate a summary of old messages using the LLM.
 * When `summarizer` is provided, calls it with a focused summarization prompt.
 * Falls back to a deterministic placeholder if no summarizer is configured
 * or if the LLM call fails — this preserves the fail-safe behavior the
 * middleware had before LLM summarization was wired up.
 */
export async function generateSummary(
  messages: unknown[],
  summarizer?: BaseChatModel,
  fallbackModelName?: string
): Promise<string> {
  if (!summarizer) {
    logger.debug("Compaction summarizer not configured; using placeholder summary", {
      messageCount: messages.length,
      modelName: fallbackModelName,
    });
    return placeholderSummary(
      messages,
      "Configure a summarizer model (compaction.summarizer) to enable LLM-generated summaries."
    );
  }

  const conversationText = messagesToText(messages);

  try {
    const response = await summarizer.invoke([
      { role: "system", content: SUMMARIZATION_PROMPT },
      {
        role: "user",
        content: `Summarize the following conversation:\n\n${conversationText}`,
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = typeof response.content === "string"
      ? response.content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : String((response as any).content ?? "");
    if (!text.trim()) {
      throw new Error("Summarizer returned empty content");
    }
    return text;
  } catch (err) {
    logger.warn("LLM-based summarization failed; using fallback summary", {
      error: err instanceof Error ? err.message : String(err),
      messageCount: messages.length,
    });
    return placeholderSummary(
      messages,
      `Summarizer call failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
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
        // Generate summary via LLM (with placeholder fallback)
        const summary = await generateSummary(
          messagesToCompact,
          options.summarizer,
          options.modelName
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
