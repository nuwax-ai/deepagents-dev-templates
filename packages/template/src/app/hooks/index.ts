/**
 * Lifecycle Hooks System
 *
 * Provides before/after hooks for tool execution and model calls.
 * Implemented as a deepagents AgentMiddleware via createHookMiddleware().
 *
 * Supported hook events:
 * - pre_tool_use: Before a tool executes (can prevent or modify args)
 * - post_tool_use: After a tool succeeds
 * - post_tool_error: After a tool fails
 * - before_model: Before the LLM is called
 * - after_model: After the LLM responds
 */

import { createMiddleware, ToolMessage } from "langchain";
import { logger } from "../../runtime/logger.js";

// ─── Types ──────────────────────────────────────────────

export type HookEvent =
  | "pre_tool_use"
  | "post_tool_use"
  | "post_tool_error"
  | "before_model"
  | "after_model";

export interface HookContext {
  /** Tool name (for tool hooks) */
  toolName?: string;
  /** Tool call arguments */
  args?: Record<string, unknown>;
  /** Tool result content (for post_tool_use) */
  result?: string;
  /** Error (for post_tool_error) */
  error?: Error;
  /** Timestamp */
  timestamp: number;
}

export interface HookResult {
  /** If true, prevent the tool from executing (pre_tool_use only) */
  prevent?: boolean;
  /** Override tool arguments (pre_tool_use only) */
  modifiedArgs?: Record<string, unknown>;
  /** Replacement result content (pre_tool_use when preventing) */
  replacementResult?: string;
}

export interface HookDefinition {
  /** Unique name for this hook */
  name: string;
  /** Which event to listen for */
  event: HookEvent;
  /** Handler function */
  handler: (ctx: HookContext) => Promise<HookResult | void>;
  /** Execution priority (lower = earlier). Default: 100 */
  priority?: number;
  /** Optional: only run for tools matching this regex pattern */
  toolPattern?: RegExp;
}

// ─── Registry ───────────────────────────────────────────

const hooks: HookDefinition[] = [];

/**
 * Register a lifecycle hook.
 * Hooks are sorted by priority (lower runs first).
 */
export function registerHook(hook: HookDefinition): void {
  hooks.push(hook);
  hooks.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  logger.info("Hook registered", { name: hook.name, event: hook.event });
}

/**
 * Remove a hook by name.
 */
export function unregisterHook(name: string): void {
  const idx = hooks.findIndex(h => h.name === name);
  if (idx >= 0) hooks.splice(idx, 1);
}

/**
 * Get all registered hooks for an event.
 */
export function getHooks(event: HookEvent): HookDefinition[] {
  return hooks.filter(h => h.event === event);
}

/**
 * Execute all hooks for an event, returning results.
 * Stops early if any hook returns { prevent: true }.
 */
async function executeHooks(event: HookEvent, ctx: HookContext): Promise<HookResult[]> {
  const matching = hooks.filter(h =>
    h.event === event && (!h.toolPattern || !ctx.toolName || h.toolPattern.test(ctx.toolName))
  );

  const results: HookResult[] = [];
  for (const hook of matching) {
    try {
      const result = await hook.handler(ctx);
      if (result) {
        results.push(result);
        if (result.prevent) break;
      }
    } catch (err) {
      logger.error(`Hook "${hook.name}" failed`, {
        event,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

// ─── Middleware Factory ─────────────────────────────────

/**
 * Create a deepagents AgentMiddleware that fires registered hooks
 * during tool execution and model calls.
 *
 * Usage:
 * ```ts
 * import { registerHook, createHookMiddleware } from "./hooks/index.js";
 *
 * registerHook({
 *   name: "audit-writes",
 *   event: "post_tool_use",
 *   toolPattern: /^write_file|edit_file$/,
 *   handler: async (ctx) => { console.log(`Wrote: ${ctx.toolName}`); },
 * });
 *
 * const middleware = createHookMiddleware();
 * // Pass to createDeepAgent({ middleware: [middleware] })
 * ```
 */
export function createHookMiddleware() {
  return createMiddleware({
    name: "lifecycleHooks",

    wrapToolCall: async (request, handler) => {
      const toolName = request.toolCall.name;
      const args = request.toolCall.args as Record<string, unknown> | undefined;
      const ctx: HookContext = {
        toolName,
        args,
        timestamp: Date.now(),
      };

      // Pre-tool hooks
      const preResults = await executeHooks("pre_tool_use", ctx);
      const prevented = preResults.find(r => r.prevent);
      if (prevented) {
        const toolCallId = request.toolCall.id;
        if (!toolCallId) {
          // Can't create ToolMessage without ID; skip prevention
          return handler(request);
        }
        return new ToolMessage({
          content: prevented.replacementResult ?? "Tool execution blocked by hook.",
          tool_call_id: toolCallId,
          name: toolName,
        });
      }

      // Apply modified args if any hook returned them
      const modifiedArgs = preResults.find(r => r.modifiedArgs)?.modifiedArgs;
      if (modifiedArgs && request.toolCall) {
        request = { ...request, toolCall: { ...request.toolCall, args: modifiedArgs } };
      }

      // Execute the tool
      try {
        const result = await handler(request);

        // Post-tool hooks
        const resultContent = result instanceof ToolMessage
          ? (typeof result.content === "string" ? result.content : JSON.stringify(result.content))
          : "";
        await executeHooks("post_tool_use", { ...ctx, result: resultContent });

        return result;
      } catch (err) {
        // Error hooks
        await executeHooks("post_tool_error", { ...ctx, error: err instanceof Error ? err : new Error(String(err)) });
        throw err;
      }
    },

    wrapModelCall: async (request, handler) => {
      await executeHooks("before_model", { timestamp: Date.now() });

      const response = await handler(request);

      await executeHooks("after_model", { timestamp: Date.now() });

      return response;
    },
  });
}
