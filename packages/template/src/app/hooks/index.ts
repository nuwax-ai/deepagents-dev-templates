/**
 * Lifecycle Hooks
 *
 * Before/after hooks for tool execution and agent lifecycle events.
 * Used for logging, validation, auditing, and side effects.
 *
 * @scaffold — Not yet wired. This module provides extension points for
 * future lifecycle hook needs. Currently has zero consumers outside this file.
 * Remove or integrate with deepagents middleware as needed.
 */

import { logger } from "../../runtime/logger.js";

export type HookPhase =
  | "before_tool"
  | "after_tool"
  | "on_tool_error"
  | "before_model_request"
  | "on_session_start"
  | "on_session_end";

export interface HookDefinition {
  phase: HookPhase;
  name: string;
  handler: (context: HookContext) => Promise<void | HookResult>;
  priority?: number; // Lower = earlier execution
}

export interface HookContext {
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: Error;
  sessionId?: string;
  timestamp: Date;
}

export interface HookResult {
  /** If true, prevent the tool from executing */
  prevent?: boolean;
  /** Override the tool arguments */
  modifiedArgs?: Record<string, unknown>;
  /** Add a message to the agent context */
  message?: string;
}

const hooks: HookDefinition[] = [];

export function registerHook(hook: HookDefinition): void {
  hooks.push(hook);
  hooks.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

export function getHooks(phase: HookPhase): HookDefinition[] {
  return hooks.filter((h) => h.phase === phase);
}

export async function executeHooks(
  phase: HookPhase,
  context: HookContext
): Promise<HookResult[]> {
  const phaseHooks = getHooks(phase);
  const results: HookResult[] = [];

  for (const hook of phaseHooks) {
    try {
      const result = await hook.handler(context);
      if (result) {
        results.push(result);
        // If any hook prevents execution, stop processing
        if (result.prevent) break;
      }
    } catch (err) {
      logger.error(`Hook "${hook.name}" failed`, {
        phase,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
