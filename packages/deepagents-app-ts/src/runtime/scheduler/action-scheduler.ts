/**
 * Action Scheduler
 *
 * Manages delayed actions: register a tool call to fire after N seconds.
 * Actions are persisted to `scheduled-actions.json` in the session directory
 * so they survive across agent turns.
 *
 * When a timer fires, the scheduler invokes the injected `ToolExecutor`
 * callback which dispatches to the appropriate tool (builtin or MCP). The
 * call is made inside the originating session's `withRuntimeStorageContext`
 * so builtin tools that read `getRuntimeStorage()` (checkpoint,
 * conversation_history, runtime_info, agent_memory) resolve the SAME session
 * the action was scheduled under — background timers otherwise run outside
 * the request's AsyncLocalStorage scope and would land in the default session.
 *
 * Inspired by the scheduling gap found across codex / nuwaxcode / pi-mono —
 * none of them provide this capability. This is a first-party implementation
 * for the deepagents template.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { logger } from "../logger.js";
import { truncate } from "../utils/string.js";
import { withRuntimeStorageContext } from "../storage/runtime-storage.js";

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
  /**
   * Workspace root captured at schedule time. Re-established as the storage
   * context when the timer fires so the target tool writes to the right place.
   */
  workspaceRoot: string;
  /** Session id captured at schedule time (see workspaceRoot). */
  sessionId: string;
  /** ISO timestamp when the action should fire */
  fireAt: string;
  /** Current status */
  status: "pending" | "running" | "fired" | "cancelled" | "failed";
  /** Error message if status is "failed" */
  error?: string;
  /** Result from the tool execution if status is "fired" */
  result?: string;
}

export type ScheduledActionStatus = ScheduledAction["status"];

/**
 * Maximum allowed delay, in seconds. Single source of truth shared by the
 * schedule_action tool (for schema-level validation) and the scheduler.
 */
export const MAX_DELAY_SECONDS = 3600;

/**
 * How many terminal (fired/cancelled/failed) actions to keep on disk and in
 * memory for `list` history. Pending/running actions are always retained.
 */
const MAX_TERMINAL_HISTORY = 50;

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
  /** Maximum allowed delay in seconds (default: MAX_DELAY_SECONDS) */
  maxDelaySeconds?: number;
}

// ─── Implementation ─────────────────────────────────────

export class ActionScheduler {
  private log = logger.child("action-scheduler");
  private timers = new Map<string, NodeJS.Timeout>();
  private actions = new Map<string, ScheduledAction>();
  readonly storagePath: string;
  private executor: ToolExecutor;
  private maxDelaySeconds: number;
  private destroyed = false;

  constructor(options: ActionSchedulerOptions) {
    this.storagePath = options.storagePath;
    this.executor = options.executor;
    this.maxDelaySeconds = options.maxDelaySeconds ?? MAX_DELAY_SECONDS;

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
    /** Captured from the live storage context; re-entered when the timer fires. */
    workspaceRoot: string;
    sessionId: string;
  }): { id: string; fireAt: string } {
    if (this.destroyed) throw new Error("ActionScheduler has been destroyed");

    const { action, toolName, toolArgs, delaySeconds, workspaceRoot, sessionId } = params;

    if (delaySeconds < 1) {
      throw new Error("delaySeconds must be at least 1");
    }
    if (delaySeconds > this.maxDelaySeconds) {
      throw new Error(`delaySeconds exceeds maximum of ${this.maxDelaySeconds}`);
    }

    const id = `sa-${randomUUID()}`;
    const now = new Date();
    const fireAt = new Date(now.getTime() + delaySeconds * 1000);

    const scheduledAction: ScheduledAction = {
      id,
      action,
      toolName,
      toolArgs,
      delaySeconds,
      workspaceRoot,
      sessionId,
      fireAt: fireAt.toISOString(),
      status: "pending",
    };

    this.actions.set(id, scheduledAction);
    this.persist();

    // Start the timer
    const timer = setTimeout(() => {
      void this.executeAction(id);
    }, delaySeconds * 1000);

    // Unref so the timer doesn't keep the Node.js process alive
    timer.unref();
    this.timers.set(id, timer);

    this.log.info("Scheduled action", { id, toolName, delaySeconds, fireAt: fireAt.toISOString() });

    return { id, fireAt: fireAt.toISOString() };
  }

  /**
   * Cancel a scheduled action. Returns false if it has already started running
   * or has fired/failed (too late to cancel).
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
  list(status?: ScheduledActionStatus): ScheduledAction[] {
    const all = Array.from(this.actions.values());
    if (status) {
      return all.filter(a => a.status === status);
    }
    return all;
  }

  /**
   * Clean up all timers. Call on session close via destroyRuntimeContext().
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

    // Flip to "running" BEFORE awaiting the executor. Without this, a cancel()
    // issued during the executor's await still sees status "pending", reports
    // success, and then this method overwrites it with "fired" — the action
    // runs despite a successful cancel. Once "running", cancel() correctly
    // returns false (too late).
    action.status = "running";
    this.persist();

    try {
      this.log.info("Executing scheduled action", { id, toolName: action.toolName });
      // Re-enter the originating session's storage context. Background timers
      // fire outside any request's AsyncLocalStorage; without this, builtin
      // tools that call getRuntimeStorage() resolve the wrong (default) session.
      const result = await withRuntimeStorageContext(
        { workspaceRoot: action.workspaceRoot, sessionId: action.sessionId },
        () => this.executor(action.toolName, action.toolArgs),
      );
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
      const data = this.collectForPersistence();
      mkdirSync(dirname(this.storagePath), { recursive: true });
      writeFileSync(this.storagePath, JSON.stringify(data, null, 2) + "\n", "utf-8");

      // Drop pruned terminal actions from memory so the map (and list()) stays
      // bounded — without this, fired/cancelled/failed actions accumulate forever.
      const keepIds = new Set(data.map(a => a.id));
      for (const id of Array.from(this.actions.keys())) {
        if (!keepIds.has(id)) {
          this.actions.delete(id);
        }
      }
    } catch (err) {
      this.log.warn("Failed to persist scheduled actions", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * All pending/running actions plus the most-recent terminal actions (bounded).
   */
  private collectForPersistence(): ScheduledAction[] {
    const all = Array.from(this.actions.values());
    const active = all.filter(a => a.status === "pending" || a.status === "running");
    const terminal = all.filter(
      a => a.status === "fired" || a.status === "cancelled" || a.status === "failed",
    );
    return [...active, ...terminal.slice(-MAX_TERMINAL_HISTORY)];
  }

  private restoreFromDisk(): void {
    if (!existsSync(this.storagePath)) return;
    try {
      const raw = JSON.parse(readFileSync(this.storagePath, "utf-8"));
      // Guard against a corrupt/hand-edited file: a non-array payload would
      // throw inside the for..of and silently abandon every pending action.
      if (!Array.isArray(raw)) {
        this.log.warn("Scheduled-actions file is not an array; skipping restore", {
          path: this.storagePath,
        });
        return;
      }
      const data = raw as ScheduledAction[];
      for (const action of data) {
        // Only restore pending actions; fired/cancelled/failed are historical
        if (action.status === "pending") {
          const remainingMs = new Date(action.fireAt).getTime() - Date.now();
          if (remainingMs > 0) {
            this.actions.set(action.id, action);
            const timer = setTimeout(() => {
              void this.executeAction(action.id);
            }, remainingMs);
            timer.unref();
            this.timers.set(action.id, timer);
            this.log.info("Restored pending action", { id: action.id, toolName: action.toolName });
          } else {
            // Already past fire time — execute immediately. The session context
            // is restored from the action's stored fields inside executeAction.
            this.actions.set(action.id, action);
            void this.executeAction(action.id);
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
