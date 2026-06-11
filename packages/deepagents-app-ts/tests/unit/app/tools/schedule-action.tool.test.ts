import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { createScheduleActionTool } from "../../../../src/app/tools/schedule-action.tool.js";
import { ActionScheduler } from "../../../../src/runtime/scheduler/action-scheduler.js";
import type { ToolExecutor } from "../../../../src/runtime/scheduler/action-scheduler.js";

describe("schedule_action tool", () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;
  let workspaceRoot: string;
  let mockExecutor: ToolExecutor;
  let executorCalls: Array<{ toolName: string; args: Record<string, unknown> }>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "schedule-action-test-"));
    workspaceRoot = join(tmpDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    process.env.DEEPAGENTS_HOME = join(tmpDir, "home");
    delete process.env.DEEPAGENTS_SESSION_ID;
    delete process.env.ACP_SESSION_ID;

    executorCalls = [];
    mockExecutor = vi.fn(async (toolName: string, args: Record<string, unknown>) => {
      executorCalls.push({ toolName, args });
      return `Executed ${toolName}`;
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createTool(extraKnownTools: string[] = []) {
    const knownTools = new Set(["close_page", "navigate_page", "http_request", ...extraKnownTools]);
    let schedulerInstance: ActionScheduler | null = null;

    const tool = createScheduleActionTool({
      knownTools,
      executor: mockExecutor,
      getScheduler: (storagePath, executor) => {
        if (!schedulerInstance) {
          schedulerInstance = new ActionScheduler({ storagePath, executor });
        }
        return schedulerInstance;
      },
    });

    return { tool, getScheduler: () => schedulerInstance };
  }

  async function invoke(tool: ReturnType<typeof createTool>["tool"], args: Record<string, unknown>) {
    return String(await tool.invoke(args));
  }

  // ── schedule ────────────────────────────────────────────

  it("schedules an action and returns confirmation", async () => {
    const { tool } = createTool();
    const result = await invoke(tool, {
      operation: "schedule",
      action: "Close browser page",
      delaySeconds: 30,
      toolName: "close_page",
    });

    expect(result).toContain("Scheduled:");
    expect(result).toContain("close_page");
    expect(result).toContain("30s");
    expect(result).toMatch(/\[sa-/);
  });

  it("rejects unknown tool name", async () => {
    const { tool } = createTool();
    const result = await invoke(tool, {
      operation: "schedule",
      action: "Do something",
      delaySeconds: 10,
      toolName: "nonexistent_tool",
    });

    expect(result).toContain("Error");
    expect(result).toContain("Unknown tool");
  });

  it("requires action description", async () => {
    const { tool } = createTool();
    const result = await invoke(tool, {
      operation: "schedule",
      delaySeconds: 10,
      toolName: "close_page",
    });

    expect(result).toContain("Error");
    expect(result).toContain("action");
  });

  it("requires toolName", async () => {
    const { tool } = createTool();
    const result = await invoke(tool, {
      operation: "schedule",
      action: "Do something",
      delaySeconds: 10,
    });

    expect(result).toContain("Error");
    expect(result).toContain("toolName");
  });

  it("requires delaySeconds >= 1", async () => {
    const { tool } = createTool();
    const result = await invoke(tool, {
      operation: "schedule",
      action: "Do something",
      delaySeconds: 0,
      toolName: "close_page",
    });

    expect(result).toContain("Error");
  });

  it("passes toolArgs to the scheduler", async () => {
    const { tool } = createTool();
    const result = await invoke(tool, {
      operation: "schedule",
      action: "Navigate to URL",
      delaySeconds: 5,
      toolName: "navigate_page",
      toolArgs: { url: "https://example.com" },
    });

    expect(result).toContain("Scheduled:");
  });

  // ── list ────────────────────────────────────────────────

  it("lists no actions initially", async () => {
    const { tool } = createTool();
    const result = await invoke(tool, { operation: "list" });
    expect(result).toContain("No scheduled actions");
  });

  it("lists scheduled actions", async () => {
    const { tool } = createTool();
    await invoke(tool, {
      operation: "schedule",
      action: "Action A",
      delaySeconds: 60,
      toolName: "close_page",
    });
    await invoke(tool, {
      operation: "schedule",
      action: "Action B",
      delaySeconds: 120,
      toolName: "http_request",
      toolArgs: { url: "https://example.com" },
    });

    const result = await invoke(tool, { operation: "list" });
    expect(result).toContain("Action A");
    expect(result).toContain("Action B");
    expect(result).toContain("close_page");
    expect(result).toContain("http_request");
  });

  // ── cancel ──────────────────────────────────────────────

  it("cancels a scheduled action", async () => {
    const { tool } = createTool();
    const scheduleResult = await invoke(tool, {
      operation: "schedule",
      action: "Will be cancelled",
      delaySeconds: 60,
      toolName: "close_page",
    });

    const idMatch = scheduleResult.match(/\[(sa-[^\]]+)\]/);
    expect(idMatch).toBeTruthy();
    const actionId = idMatch![1];

    const cancelResult = await invoke(tool, { operation: "cancel", actionId });
    expect(cancelResult).toContain("Cancelled");
    expect(cancelResult).toContain(actionId);
  });

  it("rejects cancel with invalid actionId", async () => {
    const { tool } = createTool();
    const result = await invoke(tool, { operation: "cancel", actionId: "nonexistent" });
    expect(result).toContain("not found");
  });

  it("requires actionId for cancel", async () => {
    const { tool } = createTool();
    const result = await invoke(tool, { operation: "cancel" });
    expect(result).toContain("Error");
  });

  // ── timer fires and executor is called ──────────────────

  it("executes the tool when the timer fires", async () => {
    vi.useFakeTimers();
    try {
      const { tool } = createTool();

      await invoke(tool, {
        operation: "schedule",
        action: "Quick action",
        delaySeconds: 2,
        toolName: "close_page",
        toolArgs: { pageId: 1 },
      });

      // Executor should NOT have been called yet
      expect(executorCalls).toHaveLength(0);

      // Advance time by 2 seconds
      await vi.advanceTimersByTimeAsync(2100);

      // Now executor should have been called
      expect(executorCalls).toHaveLength(1);
      expect(executorCalls[0].toolName).toBe("close_page");
      expect(executorCalls[0].args).toEqual({ pageId: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not execute cancelled actions", async () => {
    vi.useFakeTimers();
    try {
      const { tool } = createTool();

      const scheduleResult = await invoke(tool, {
        operation: "schedule",
        action: "Will be cancelled",
        delaySeconds: 3,
        toolName: "close_page",
      });
      const actionId = scheduleResult.match(/\[(sa-[^\]]+)\]/)![1];

      await invoke(tool, { operation: "cancel", actionId });
      await vi.advanceTimersByTimeAsync(4000);

      expect(executorCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── persistence ─────────────────────────────────────────

  it("persists actions to disk", async () => {
    const { tool, getScheduler } = createTool();
    await invoke(tool, {
      operation: "schedule",
      action: "Persisted action",
      delaySeconds: 300,
      toolName: "close_page",
    });

    const scheduler = getScheduler();
    expect(scheduler).toBeTruthy();

    // Check that the storage file exists
    const storage = (await import("../../../../src/runtime/storage/runtime-storage.js")).getRuntimeStorage();
    expect(existsSync(storage.scheduledActionsPath)).toBe(true);
  });
});
