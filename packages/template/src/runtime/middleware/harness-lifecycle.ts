import { createMiddleware } from "langchain";
import {
  beginHarnessToolCall,
  beginHarnessTurn,
  completeHarnessToolCall,
  completeHarnessTurn,
  failHarnessTurn,
  recordHarnessModelCall,
} from "../storage/harness-lifecycle.js";
import { logger } from "../logger.js";

/**
 * Extract a short text preview of the most recent user message from the
 * middleware state. Falls back to undefined if the state has no messages
 * or the latest message isn't a user-role message we can stringify.
 */
function extractInputPreview(messages: unknown): string | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  // Walk backwards to find the latest HumanMessage; its content is the
  // most recent user input.
  for (let i = messages.length - 1; i >= 0; i--) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = messages[i] as any;
    const role = m?.role ?? m?.type;
    if (role !== "human" && role !== "user") continue;
    const content = m?.content;
    if (typeof content === "string") return content.slice(0, 500);
    if (Array.isArray(content)) {
      const text = content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
        .filter(Boolean)
        .join("\n");
      if (text) return text.slice(0, 500);
    }
    return undefined;
  }
  return undefined;
}

/**
 * Per-agent-turn tracking middleware.
 *
 * Hooks:
 *   - `beforeAgent`     → `beginHarnessTurn(extractInputPreview(messages))`
 *                         (counters.turns++, phase=running, inputPreview set
 *                         from the latest user message)
 *   - `afterAgent`      → `completeHarnessTurn` (phase=idle, clears pendingWrites)
 *   - `wrapModelCall`   → `recordHarnessModelCall` on each LLM call;
 *                         on error, calls `failHarnessTurn` (best-effort;
 *                         try/catch wrapped so a lifecycle-file write
 *                         failure does not mask the original model error)
 *                         and rethrows.
 *   - `wrapToolCall`    → `beginHarnessToolCall` / `completeHarnessToolCall`
 *                         for per-tool-call counter and pendingWrites tracking.
 *
 * This middleware is the SOLE owner of the turn lifecycle in ACP mode — the
 * ACP handlePrompt wrapper in acp-server.ts no longer calls begin/complete/
 * fail directly (it appends the user message and forwards). Wiring at
 * the middleware layer (rather than the wrapper layer) gives us the
 * right granularity: the begin/complete pair brackets the agent loop
 * once per prompt, and failed turns are recorded at the exact layer
 * where the model error originates.
 *
 * Storage is resolved per-call via `getRuntimeStorage()` so the middleware
 * reads the right `~/.deepagents/workspaces/<slug>/sessions/<sid>/` from the
 * AsyncLocalStorage context set up by the ACP session layer.
 */
export function createHarnessLifecycleMiddleware() {
  const log = logger.child("harnessLifecycle");

  return createMiddleware({
    name: "harnessLifecycle",

    beforeAgent: async (state) => {
      // state shape: { messages: BaseMessage[], ... } — see langchain's
      // BeforeAgentHook type. Pull the latest user message for inputPreview
      // so the lifecycle JSON records what the user actually said.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputPreview = extractInputPreview((state as any)?.messages);
      beginHarnessTurn(inputPreview);
    },

    afterAgent: async () => {
      completeHarnessTurn();
    },

    wrapModelCall: async (request, handler) => {
      recordHarnessModelCall();
      try {
        return await handler(request);
      } catch (err) {
        // Best-effort: the lifecycle file write can fail (disk full,
        // EACCES, etc.). Don't let that swallow the real model error.
        try {
          failHarnessTurn(err);
        } catch (lifecycleErr) {
          log.warn("failHarnessTurn itself failed; preserving original model error", {
            lifecycleError: lifecycleErr instanceof Error ? lifecycleErr.message : String(lifecycleErr),
            originalError: err instanceof Error ? err.message : String(err),
          });
        }
        throw err;
      }
    },

    wrapToolCall: async (request, handler) => {
      const { id } = beginHarnessToolCall(
        request.toolCall.name,
        request.toolCall.args ?? {}
      );
      try {
        return await handler(request);
      } finally {
        completeHarnessToolCall(id);
      }
    },
  });
}

