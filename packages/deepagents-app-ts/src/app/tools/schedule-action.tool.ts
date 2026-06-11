/**
 * Schedule Action Tool
 *
 * Schedule delayed tool invocations that fire after a specified number of seconds.
 * The agent can schedule an action and immediately get back a confirmation —
 * the actual execution happens in the background via ActionScheduler.
 *
 * Use cases:
 * - "Close the browser page after 30 seconds"
 * - "Send a reminder webhook in 5 minutes"
 * - "Clean up temporary files after 2 minutes"
 *
 * Operations:
 * - schedule: Register a delayed action
 * - list:     Show all pending and recently fired actions
 * - cancel:   Cancel a pending action by ID
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ActionScheduler, ScheduledAction, ToolExecutor } from "../../runtime/scheduler/action-scheduler.js";
import { ensureSessionState, getRuntimeStorage } from "../../runtime/storage/runtime-storage.js";

export interface ScheduleActionToolOptions {
  /** Set of known tool names (builtin + MCP) for validation */
  knownTools: Set<string>;
  /** Factory to create or retrieve the ActionScheduler for the current session */
  getScheduler: (storagePath: string, executor: ToolExecutor) => ActionScheduler;
  /** Tool executor callback — invokes the target tool when a timer fires */
  executor: ToolExecutor;
}

export function createScheduleActionTool(options: ScheduleActionToolOptions) {
  return tool(
    async ({ operation, action, delaySeconds, toolName, toolArgs, actionId }) => {
      const storage = getRuntimeStorage();
      ensureSessionState(storage);
      const scheduler = options.getScheduler(storage.scheduledActionsPath, options.executor);

      switch (operation) {
        case "schedule": {
          if (!action) return "Error: `action` (description) is required for schedule";
          if (!toolName) return "Error: `toolName` is required for schedule";
          if (!delaySeconds || delaySeconds < 1) return "Error: `delaySeconds` must be >= 1";

          // Validate tool name is known
          if (!options.knownTools.has(toolName)) {
            const known = Array.from(options.knownTools).sort().join(", ");
            return `Error: Unknown tool "${toolName}". Available tools: ${known}`;
          }

          try {
            const result = scheduler.schedule({
              action,
              toolName,
              toolArgs: toolArgs ?? {},
              delaySeconds,
            });
            return `Scheduled: [${result.id}] "${action}" → ${toolName} in ${delaySeconds}s (fires at ${result.fireAt})`;
          } catch (err) {
            return `Failed to schedule: ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        case "list": {
          const actions = scheduler.list();
          if (actions.length === 0) return "No scheduled actions.";

          const lines = actions.map(formatAction);
          return `Scheduled actions (${actions.length}):\n${lines.join("\n")}`;
        }

        case "cancel": {
          if (!actionId) return "Error: `actionId` is required for cancel";
          const cancelled = scheduler.cancel(actionId);
          if (!cancelled) {
            return `Action "${actionId}" not found or already fired/cancelled.`;
          }
          return `Cancelled: [${actionId}]`;
        }

        default:
          return `Unknown operation: ${operation}`;
      }
    },
    {
      name: "schedule_action",
      description: `Schedule a delayed tool invocation that fires automatically after a specified number of seconds.
The action runs in the background — you get an immediate confirmation and can continue working.
Use this for "do X after N seconds" scenarios like auto-closing a browser page or sending a delayed webhook.
Operations:
- schedule: Register a new delayed action (requires action, toolName, delaySeconds)
- list:     Show all pending and recently executed actions
- cancel:   Cancel a pending action by ID`,
      schema: z.object({
        operation: z.enum(["schedule", "list", "cancel"]).describe("Operation to perform"),
        action: z.string().optional().describe("Human-readable description of what the action does — required for schedule"),
        delaySeconds: z.number().optional().describe("Delay in seconds before the action fires (1–3600) — required for schedule"),
        toolName: z.string().optional().describe("Name of the tool to invoke when the timer fires — required for schedule"),
        toolArgs: z.record(z.unknown()).optional().describe("Arguments to pass to the target tool"),
        actionId: z.string().optional().describe("Action ID — required for cancel"),
      }),
    }
  );
}

// ─── Helpers ──────────────────────────────────────────────

const STATUS_ICON: Record<ScheduledAction["status"], string> = {
  pending: "⏳",
  fired: "✅",
  cancelled: "❌",
  failed: "⚠️",
};

function formatAction(a: ScheduledAction): string {
  const icon = STATUS_ICON[a.status] ?? "?";
  const error = a.error ? ` — ERROR: ${a.error}` : "";
  const result = a.result ? ` → ${a.result.slice(0, 100)}` : "";
  return `${icon} [${a.id}] "${a.action}" → ${a.toolName} in ${a.delaySeconds}s${error}${result}`;
}
