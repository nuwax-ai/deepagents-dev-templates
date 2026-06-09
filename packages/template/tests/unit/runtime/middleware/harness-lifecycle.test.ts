import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  beginHarnessToolCall,
  beginHarnessTurn,
  completeHarnessToolCall,
  completeHarnessTurn,
  failHarnessTurn,
  readHarnessLifecycle,
  recordHarnessModelCall,
} from "../../../../src/runtime/storage/harness-lifecycle.js";
import { getRuntimeStorage } from "../../../../src/runtime/storage/runtime-storage.js";
import { createHarnessLifecycleMiddleware } from "../../../../src/runtime/middleware/harness-lifecycle.js";

describe("harness-lifecycle", () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "harness-lifecycle-test-"));
    workspaceRoot = join(tmpDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    process.env.DEEPAGENTS_HOME = join(tmpDir, "home");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("tracks turn, model call, tool call, pending write, and completion", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_harness" });

    beginHarnessTurn("hello", storage);
    recordHarnessModelCall(storage);
    const pending = beginHarnessToolCall("write_file", { file_path: "/tmp/a.txt" }, storage);

    expect(readHarnessLifecycle(storage)).toMatchObject({
      phase: "tool_call",
      busy: true,
      counters: {
        turns: 1,
        modelCalls: 1,
        toolCalls: 1,
        failedTurns: 0,
      },
      pendingWrites: [expect.objectContaining({ path: "/tmp/a.txt" })],
    });

    completeHarnessToolCall(pending.id, storage);
    completeHarnessTurn(storage);

    expect(readHarnessLifecycle(storage)).toMatchObject({
      phase: "idle",
      busy: false,
      pendingWrites: [],
      currentTurn: expect.objectContaining({
        inputPreview: "hello",
        modelCalls: 1,
        toolCalls: 1,
      }),
    });
  });

  it("marks failed turns and clears pending writes", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_failed" });

    beginHarnessTurn("explode", storage);
    beginHarnessToolCall("edit_file", { file_path: "/tmp/b.txt" }, storage);
    failHarnessTurn(new Error("boom"), storage);

    expect(readHarnessLifecycle(storage)).toMatchObject({
      phase: "failed",
      busy: false,
      pendingWrites: [],
      lastError: "boom",
      counters: expect.objectContaining({ failedTurns: 1 }),
    });
  });

  // ─── Turn transition primitives (G7 regression) ───────────────────────
  // These isolate the begin → complete / begin → fail paths so the
  // middleware's beforeAgent / afterAgent / wrapModelCall-error wiring can be
  // verified through unit-level primitives. Before this split, only the
  // combined "tracks turn, model call, tool call, ..." test covered these
  // transitions, so the missing harness turn tracking bug (counters.turns
  // stayed at 0) wasn't caught by the existing suite.

  it("beginHarnessTurn transitions idle → running and increments turns", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_begin" });

    expect(readHarnessLifecycle(storage)).toMatchObject({
      phase: "idle",
      busy: false,
      counters: { turns: 0 },
    });
    expect(readHarnessLifecycle(storage).currentTurn).toBeUndefined();

    beginHarnessTurn("hi", storage);

    const snap = readHarnessLifecycle(storage);
    expect(snap.phase).toBe("running");
    expect(snap.busy).toBe(true);
    expect(snap.counters.turns).toBe(1);
    expect(snap.currentTurn).toMatchObject({
      index: 1,
      inputPreview: "hi",
      modelCalls: 0,
      toolCalls: 0,
    });
    expect(snap.currentTurn!.id).toBeDefined();
    expect(snap.currentTurn!.startedAt).toBeDefined();
  });

  it("completeHarnessTurn transitions running → idle and freezes counters", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_complete" });

    beginHarnessTurn("first", storage);
    recordHarnessModelCall(storage);
    const turnsAfterBegin = readHarnessLifecycle(storage).counters.turns;

    completeHarnessTurn(storage);

    const snap = readHarnessLifecycle(storage);
    expect(snap.phase).toBe("idle");
    expect(snap.busy).toBe(false);
    // turns is a monotonically increasing counter — does NOT decrement.
    expect(snap.counters.turns).toBe(turnsAfterBegin);
    // modelCalls counter persists (it's a session-wide counter).
    expect(snap.counters.modelCalls).toBe(1);
    // currentTurn retains its snapshot with endedAt set.
    expect(snap.currentTurn).toMatchObject({
      index: 1,
      inputPreview: "first",
      modelCalls: 1,
      toolCalls: 0,
    });
    expect(snap.currentTurn!.endedAt).toBeDefined();
  });

  it("failHarnessTurn transitions running → failed and records lastError", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_fail_only" });

    beginHarnessTurn("dying", storage);
    failHarnessTurn(new Error("kaboom"), storage);

    const snap = readHarnessLifecycle(storage);
    expect(snap.phase).toBe("failed");
    expect(snap.busy).toBe(false);
    expect(snap.counters.failedTurns).toBe(1);
    expect(snap.lastError).toBe("kaboom");
    // currentTurn retains its snapshot with endedAt set.
    expect(snap.currentTurn).toMatchObject({
      index: 1,
      inputPreview: "dying",
    });
    expect(snap.currentTurn!.endedAt).toBeDefined();
  });

  // ─── Middleware wiring regression (G7 fix) ───────────────────────────
  // The tests above call the begin/complete/fail primitives directly, which
  // would still pass if the harness-lifecycle middleware's beforeAgent /
  // afterAgent / wrapModelCall-catch hooks were silently removed (the
  // original G7 bug: counters.turns stayed at 0 because the hooks were
  // never invoked). The tests below call the hooks on the middleware
  // object directly to verify the wiring is intact.

  it("createHarnessLifecycleMiddleware wires beforeAgent → beginHarnessTurn (G7 regression)", async () => {
    const sessionId = "sess_mw_begin";
    // Set the AsyncLocalStorage context for the duration of the hook so
    // getRuntimeStorage() in the lifecycle module reads the right session.
    const { withRuntimeStorageContext } = await import(
      "../../../../src/runtime/storage/runtime-storage.js"
    );
    await withRuntimeStorageContext({ workspaceRoot, sessionId }, async () => {
      const mw = createHarnessLifecycleMiddleware();
      expect(mw.name).toBe("harnessLifecycle");
      expect(typeof mw.beforeAgent).toBe("function");

      // Simulate langchain passing state with a user message in the messages
      // array — the middleware should extract the preview.
      const fakeState = {
        messages: [
          { role: "system", content: "you are a helpful assistant" },
          { role: "human", content: "what is 2+2?" },
        ],
      };
      await mw.beforeAgent!(fakeState as never, {} as never);

      const snap = readHarnessLifecycle(
        getRuntimeStorage({ workspaceRoot, sessionId })
      );
      expect(snap.phase).toBe("running");
      expect(snap.busy).toBe(true);
      expect(snap.counters.turns).toBe(1);
      expect(snap.currentTurn?.inputPreview).toBe("what is 2+2?");
    });
  });

  it("createHarnessLifecycleMiddleware wires afterAgent → completeHarnessTurn", async () => {
    const sessionId = "sess_mw_complete";
    const { withRuntimeStorageContext } = await import(
      "../../../../src/runtime/storage/runtime-storage.js"
    );
    await withRuntimeStorageContext({ workspaceRoot, sessionId }, async () => {
      const mw = createHarnessLifecycleMiddleware();

      await mw.beforeAgent!(
        { messages: [{ role: "human", content: "go" }] } as never,
        {} as never
      );
      expect(readHarnessLifecycle(getRuntimeStorage({ workspaceRoot, sessionId })).phase).toBe("running");

      await mw.afterAgent!({} as never, {} as never);
      const snap = readHarnessLifecycle(
        getRuntimeStorage({ workspaceRoot, sessionId })
      );
      expect(snap.phase).toBe("idle");
      expect(snap.busy).toBe(false);
      // Counters persist across the turn boundary — only phase/busy flip.
      expect(snap.counters.turns).toBe(1);
    });
  });

  it("createHarnessLifecycleMiddleware wires wrapModelCall catch → failHarnessTurn", async () => {
    const sessionId = "sess_mw_fail";
    const { withRuntimeStorageContext } = await import(
      "../../../../src/runtime/storage/runtime-storage.js"
    );
    await withRuntimeStorageContext({ workspaceRoot, sessionId }, async () => {
      const mw = createHarnessLifecycleMiddleware();

      await mw.beforeAgent!(
        { messages: [{ role: "human", content: "x" }] } as never,
        {} as never
      );

      // Simulate a model call that throws.
      const throwingHandler = async () => {
        throw new Error("rate-limit-429");
      };
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mw.wrapModelCall as any)({ toolCall: { name: "model", id: "tc_1", args: {} } }, throwingHandler)
      ).rejects.toThrow("rate-limit-429");

      const snap = readHarnessLifecycle(
        getRuntimeStorage({ workspaceRoot, sessionId })
      );
      // The catch path must mark the turn failed; counters.failedTurns++.
      expect(snap.phase).toBe("failed");
      expect(snap.counters.failedTurns).toBe(1);
      expect(snap.lastError).toBe("rate-limit-429");
    });
  });
});

