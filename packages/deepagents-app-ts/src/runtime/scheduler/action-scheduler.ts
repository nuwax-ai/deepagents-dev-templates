/**
 * Action Scheduler
 *
 * Manages delayed actions: register a tool call to fire after N seconds.
 * Actions are persisted to `scheduled-actions.json` in the session directory
 * so they survive across agent turns.
 *
 * When a timer fires, the scheduler invokes the injected `ToolExecutor`
 * callback which dispatches to the appropriate tool (builtin or MCP).
 *
 * Inspired by the scheduling gap found across codex / nuwaxcode / pi-mono —
 * none of them provide this capability. This is a first-party implementation
 * for the deepagents template.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "../logger.js";

// ─── Types ──────────────────────────────────────────────

export interface ScheduledAction {
  id: string;
  /** Human-readable description of what the action does */
  action: string;
  /** Tool name to invoke when the timer fires */
  toolName: string;
  /** Arguments to pass to the tool */
  toolArgs: Record<string, unknown>;
  /** Delay in seconds */
  delaySeconds: number;
  /** ISO timestamp when the action was created */
  createdAt: string;
  /** ISO timestamp when the action should fire */
  fireAt: string;
  /** Current status */
  status: "pending" | "fired" | "cancelled" | "failed";
  /** Error message if status is "failed" */
  error?: string;
  /** Result from the tool execution if status is "fired" */
  result?: string;
}

/**
 * Callback that executes a tool by name with the given arguments.
 * The runtime injects this when creating the scheduler.
 */
export type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<string>;

export interface ActionSchedulerOptions {
  /** Path to persist scheduled actions (session dir / scheduled-actions.json) */
  storagePath: string;
  /** Callback to execute tools when timers fire */
  executor: ToolExecutor;
  /** Maximum allowed delay in seconds (default: 3600 = 1 hour) */
  maxDelaySeconds?: number;
}

// ─── Implementation ─────────────────────────────────────

export class ActionScheduler {
  private log = logger.child("action-scheduler");
  private timers = new Map<string, NodeJS.Timeout>();
  private actions = new Map<string, ScheduledAction>();
  private storagePath: string;
  private executor: ToolExecutor;
  private maxDelaySeconds: number;
  private destroyed = false;

  constructor(options: ActionSchedulerOptions) {
    this.storagePath = options.storagePath;
    this.executor = options.executor;
    this.maxDelaySeconds = options.maxDelaySeconds ?? 3600;

    // Restore persisted actions from previous runs
    this.restoreFromDisk();
  }

  /**
   * Schedule a delayed action. Returns the action ID.
   */
  schedule(params: {
    action: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    delaySeconds: number;
  }): { id: string; fireAt: string } {
    if (this.destroyed) throw new Error("ActionScheduler has been destroyed");

    const { action, toolName, toolArgs, delaySeconds } = params;

    if (delaySeconds < 1) {
      throw new Error("delaySeconds must be at least 1");
    }
    if (delaySeconds > this.maxDelaySeconds) {
      throw new Error(`delaySeconds exceeds maximum of ${this.maxDelaySeconds}`);
    }

    const id = generateActionId();
    const now = new Date();
    const fireAt = new Date(now.getTime() + delaySeconds * 1000);

    const scheduledAction: ScheduledAction = {
      id,
      action,
      toolName,
      toolArgs,
      delaySeconds,
      createdAt: now.toISOString(),
      fireAt: fireAt.toISOString(),
      status: "pending",
    };

    this.actions.set(id, scheduledAction);
    this.persist();

    // Start the timer
    const timer = setTimeout(() => {
      this.executeAction(id);
    }, delaySeconds * 1000);

    // Unref so the timer doesn't keep the Node.js process alive
    timer.unref();
    this.timers.set(id, timer);

    this.log.info("Scheduled action", { id, toolName, delaySeconds, fireAt: fireAt.toISOString() });

    return { id, fireAt: fireAt.toISOString() };
  }

  /**
   * Cancel a scheduled action.
   */
  cancel(actionId: string): boolean {
    const action = this.actions.get(actionId);
    if (!action || action.status !== "pending") {
      return false;
    }

    const timer = this.timers.get(actionId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(actionId);
    }

    action.status = "cancelled";
    this.persist();

    this.log.info("Cancelled action", { id: actionId });
    return true;
  }

  /**
   * List all actions (optionally filtered by status).
   */
  list(status?: ScheduledAction["status"]): ScheduledAction[] {
    const all = Array.from(this.actions.values());
    if (status) {
      return all.filter(a => a.status === status);
    }
    return all;
  }

  /**
   * Clean up all timers. Call on process exit or session close.
   */
  destroy(): void {
    this.destroyed = true;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.log.info("ActionScheduler destroyed", {
      pendingActions: this.list("pending").length,
    });
  }

  // ── Private ───────────────────────────────────────────

  private async executeAction(id: string): Promise<void> {
    const action = this.actions.get(id);
    if (!action || action.status !== "pending") return;

    this.timers.delete(id);

    try {
      this.log.info("Executing scheduled action", { id, toolName: action.toolName });
      const result = await this.executor(action.toolName, action.toolArgs);
      action.status = "fired";
      action.result = truncate(result, 500);
      this.log.info("Scheduled action completed", { id, toolName: action.toolName });
    } catch (err) {
      action.status = "failed";
      action.error = err instanceof Error ? err.message : String(err);
      this.log.error("Scheduled action failed", { id, error: action.error });
    }

    this.persist();
  }

  private persist(): void {
    try {
      const data = Array.from(this.actions.values());
      mkdirSync(dirname(this.storagePath), { recursive: true });
      writeFileSync(this.storagePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    } catch (err) {
      this.log.warn("Failed to persist scheduled actions", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private restoreFromDisk(): void {
    if (!existsSync(this.storagePath)) return;
    try {
      const data = JSON.parse(readFileSync(this.storagePath, "utf-8")) as ScheduledAction[];
      for (const action of data) {
        // Only restore pending actions; fired/cancelled/failed are historical
        if (action.status === "pending") {
          const remainingMs = new Date(action.fireAt).getTime() - Date.now();
          if (remainingMs > 0) {
            this.actions.set(action.id, action);
            const timer = setTimeout(() => this.executeAction(action.id), remainingMs);
            timer.unref();
            this.timers.set(action.id, timer);
            this.log.info("Restored pending action", { id: action.id, toolName: action.toolName });
          } else {
            // Already past fire time — execute immediately
            action.status = "pending"; // ensure status is set for executeAction
            this.actions.set(action.id, action);
            this.executeAction(action.id);
          }
        } else {
          this.actions.set(action.id, action);
        }
      }
    } catch (err) {
      this.log.warn("Failed to restore scheduled actions from disk", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────

function generateActionId(): string {
  return `sa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "... [truncated]";
}
