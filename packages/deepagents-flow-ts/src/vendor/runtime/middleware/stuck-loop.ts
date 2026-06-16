/**
 * Stuck Loop Detection Middleware
 *
 * Detects when the agent gets stuck in repetitive tool call patterns:
 * (a) Repeated identical tool calls (same name + same args)
 * (b) A-B-A-B alternating patterns
 * (c) No-op calls returning the same result
 *
 * Inspired by pydantic-deepagents' StuckLoopDetection capability.
 */

import { createMiddleware, ToolMessage } from "langchain";

export interface StuckLoopOptions {
  /** Number of repeated calls before triggering. Default: 3 */
  threshold?: number;
  /** Whether to warn (retry) or error (stop). Default: "warn" */
  mode?: "warn" | "error";
}

interface CallRecord {
  name: string;
  argsKey: string;
  resultKey: string;
}

function detectPatterns(history: CallRecord[], threshold: number): string | null {
  if (history.length < threshold) return null;

  const recent = history.slice(-threshold);

  // Pattern (a): All identical calls (same name + same args)
  const allSameCall = recent.every(
    (c) => c.name === recent[0]!.name && c.argsKey === recent[0]!.argsKey
  );
  if (allSameCall) {
    return `Stuck in loop: "${recent[0]!.name}" called ${threshold} times with identical arguments`;
  }

  // Pattern (b): A-B-A-B alternating (needs at least 4 entries)
  if (threshold >= 4 && recent.length >= 4) {
    const isAlternating = recent.every((c, i) => {
      const expected = recent[i % 2]!;
      return c.name === expected.name && c.argsKey === expected.argsKey;
    });
    if (isAlternating && recent[0]!.name !== recent[1]!.name) {
      return `Stuck in alternating loop: "${recent[0]!.name}" ↔ "${recent[1]!.name}" repeated ${threshold / 2} times`;
    }
  }

  // Pattern (c): Same call with same result (no-op)
  const allSameResult = recent.every(
    (c) =>
      c.name === recent[0]!.name &&
      c.argsKey === recent[0]!.argsKey &&
      c.resultKey === recent[0]!.resultKey &&
      c.resultKey !== ""
  );
  if (allSameResult) {
    return `Stuck in no-op loop: "${recent[0]!.name}" returns identical result ${threshold} times`;
  }

  return null;
}

/**
 * Create a stuck-loop detection middleware.
 *
 * Tracks recent tool calls and detects repetitive patterns.
 * When a loop is detected, returns a ToolMessage instructing the agent
 * to try a different approach.
 */
export function createStuckLoopMiddleware(options: StuckLoopOptions = {}) {
  const threshold = options.threshold ?? 3;
  const mode = options.mode ?? "warn";

  // Per-session history (reset on each agent invocation via beforeAgent)
  let callHistory: CallRecord[] = [];

  return createMiddleware({
    name: "stuckLoopDetection",

    beforeAgent: async () => {
      callHistory = [];
    },

    wrapToolCall: async (request, handler) => {
      const name = request.toolCall.name;
      const argsKey = JSON.stringify(request.toolCall.args ?? {});

      // Execute the tool normally
      const result = await handler(request);

      // Extract result content for comparison
      let resultKey = "";
      if (result instanceof ToolMessage) {
        resultKey = typeof result.content === "string" ? result.content : JSON.stringify(result.content);
      }

      callHistory.push({ name, argsKey, resultKey });

      // Check for loops
      const loopMsg = detectPatterns(callHistory, threshold);
      if (loopMsg) {
        if (mode === "error") {
          throw new Error(loopMsg);
        }
        // warn mode: replace the tool result with a retry instruction
        // Use the actual tool_call_id from the request to maintain parity
        const toolCallId = request.toolCall.id;
        if (!toolCallId) {
          // No ID means we can't create a valid ToolMessage; return original result
          return result;
        }
        return new ToolMessage({
          content: `⚠️ LOOP DETECTED: ${loopMsg}\n\nYou MUST try a completely different approach. Do NOT repeat the same tool call with the same arguments. Analyze why the previous attempts failed and change your strategy.`,
          tool_call_id: toolCallId,
          name,
        });
      }

      return result;
    },
  });
}
