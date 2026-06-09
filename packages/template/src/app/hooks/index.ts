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
import { spawn } from "node:child_process";
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

export interface ConfiguredHook {
  event:
    | "pre_tool_use"
    | "post_tool_use"
    | "post_tool_use_failure"
    | "before_model_request"
    | "after_model_request"
    | "before_run"
    | "after_run";
  matcher?: string;
  command: string;
  timeoutMs?: number;
  priority?: number;
  scope?: "user" | "project";
}

// ─── Registry ───────────────────────────────────────────

const hooks: HookDefinition[] = [];
const configuredHookNames = new Set<string>();

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

export function registerConfiguredHooks(configuredHooks: ConfiguredHook[], workspaceRoot: string): void {
  configuredHooks.forEach((configuredHook, index) => {
    const event = mapConfiguredEvent(configuredHook.event);
    if (!event) {
      logger.warn("Configured hook event is not supported by middleware yet", {
        event: configuredHook.event,
        command: configuredHook.command,
      });
      return;
    }

    const name = `configured:${configuredHook.scope ?? "config"}:${index}:${configuredHook.event}:${configuredHook.command}`;
    if (configuredHookNames.has(name)) {
      return;
    }

    registerHook({
      name,
      event,
      priority: configuredHook.priority,
      toolPattern: configuredHook.matcher ? new RegExp(configuredHook.matcher) : undefined,
      handler: (ctx) => runCommandHook(configuredHook, ctx, workspaceRoot),
    });
    configuredHookNames.add(name);
  });
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

function mapConfiguredEvent(event: ConfiguredHook["event"]): HookEvent | null {
  switch (event) {
    case "pre_tool_use":
      return "pre_tool_use";
    case "post_tool_use":
      return "post_tool_use";
    case "post_tool_use_failure":
      return "post_tool_error";
    case "before_model_request":
      return "before_model";
    case "after_model_request":
      return "after_model";
    default:
      return null;
  }
}

async function runCommandHook(
  hook: ConfiguredHook,
  ctx: HookContext,
  workspaceRoot: string
): Promise<HookResult | void> {
  const input = JSON.stringify({
    event: hook.event,
    toolName: ctx.toolName,
    args: ctx.args,
    result: ctx.result,
    error: ctx.error?.message,
    timestamp: ctx.timestamp,
    workspaceRoot,
  });
  const { code, stdout, stderr } = await runShellCommand(hook.command, input, workspaceRoot, hook.timeoutMs ?? 30_000);

  if (stderr.trim()) {
    logger.warn("Configured hook wrote to stderr", {
      event: hook.event,
      command: hook.command,
      stderr: stderr.slice(0, 1000),
    });
  }

  const parsed = parseHookStdout(stdout);
  if (code === 2) {
    return {
      prevent: true,
      replacementResult:
        parsed?.replacementResult ??
        (stdout.trim() || `Tool execution blocked by configured hook: ${hook.command}`),
    };
  }

  if (code !== 0) {
    logger.warn("Configured hook exited non-zero", {
      event: hook.event,
      command: hook.command,
      code,
    });
    return undefined;
  }

  return parsed;
}

function runShellCommand(
  command: string,
  input: string,
  cwd: string,
  timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.env.SHELL || "sh", ["-lc", command], { cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: 124, stdout, stderr: `${stderr}\nHook timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function parseHookStdout(stdout: string): HookResult | undefined {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as HookResult;
    return parsed;
  } catch {
    return undefined;
  }
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
