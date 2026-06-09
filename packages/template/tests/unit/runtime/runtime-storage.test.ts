import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import {
  appendRuntimeMessage,
  closeSessionState,
  ensureSessionState,
  getRuntimeStorage,
  loadSessionState,
  listSessions,
  memoryPath,
  migrateLegacyState,
  readableMemoryPath,
  readRuntimeMessages,
  readSessionMetadata,
} from "../../../src/runtime/storage/runtime-storage.js";

describe("runtime-storage", () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "runtime-storage-test-"));
    workspaceRoot = join(tmpDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    process.env.DEEPAGENTS_HOME = join(tmpDir, "home");
    delete process.env.DEEPAGENTS_SESSION_ID;
    delete process.env.ACP_SESSION_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates session state under ~/.deepagents/workspaces", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_test" });
    ensureSessionState(storage, { mode: "test" });

    expect(storage.workspaceDir).toContain(join(tmpDir, "home", "workspaces"));
    expect(existsSync(storage.metadataPath)).toBe(true);
    expect(existsSync(storage.messagesPath)).toBe(true);
    expect(existsSync(storage.planPath)).toBe(true);
    expect(existsSync(storage.todosPath)).toBe(true);
    expect(existsSync(storage.checkpointsDir)).toBe(true);
  });

  it("appends messages and lists sessions", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_messages" });
    appendRuntimeMessage({ role: "user", content: "hello" }, storage);
    appendRuntimeMessage({ role: "assistant", content: "world" }, storage);

    const content = readFileSync(storage.messagesPath, "utf-8");
    expect(content.trim().split("\n")).toHaveLength(2);
    expect(listSessions(workspaceRoot)[0]?.sessionId).toBe("sess_messages");
    expect(listSessions(workspaceRoot)[0]?.messageCount).toBe(2);
  });

  it("reads messages and marks sessions closed durably", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_close" });
    appendRuntimeMessage({ role: "user", content: "hello" }, storage);

    const closed = closeSessionState(workspaceRoot, "sess_close", { mode: "agent" });

    expect(closed.status).toBe("closed");
    expect(closed.messageCount).toBe(1);
    expect(readSessionMetadata(workspaceRoot, "sess_close")?.status).toBe("closed");
    expect(readRuntimeMessages(workspaceRoot, "sess_close")).toEqual([
      expect.objectContaining({ role: "user", content: "hello" }),
    ]);
    expect(listSessions(workspaceRoot)[0]).toMatchObject({
      sessionId: "sess_close",
      status: "closed",
      messageCount: 1,
    });
  });

  it("loads a durable session summary with bounded recent messages", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_load" });
    appendRuntimeMessage({ role: "user", content: "first" }, storage);
    appendRuntimeMessage({ role: "assistant", content: "second" }, storage);
    appendRuntimeMessage({ role: "user", content: "third" }, storage);

    const loaded = loadSessionState(workspaceRoot, "sess_load", { maxMessages: 2 });

    expect(loaded.exists).toBe(true);
    expect(loaded.summary).toMatchObject({
      sessionId: "sess_load",
      status: "active",
      messageCount: 3,
    });
    expect(loaded.messages.map((message) => message.content)).toEqual(["second", "third"]);
    expect(loaded.plan).toContain("# Plan");
    expect(loaded.todos).toBe("[]\n");
  });

  it("reads legacy memory until it is migrated", () => {
    const legacyPath = join(workspaceRoot, ".agent-memory", "agent-a", "MEMORY.md");
    mkdirSync(join(workspaceRoot, ".agent-memory", "agent-a"), { recursive: true });
    writeFileSync(legacyPath, "## Notes\nlegacy", "utf-8");

    expect(readableMemoryPath("agent-a", workspaceRoot)).toBe(legacyPath);

    const result = migrateLegacyState(workspaceRoot, "sess_migrate");
    expect(result.memoryFiles).toBe(1);
    expect(existsSync(memoryPath("agent-a", workspaceRoot))).toBe(true);
    expect(readableMemoryPath("agent-a", workspaceRoot)).toBe(memoryPath("agent-a", workspaceRoot));
  });

  it("migrates legacy checkpoints into the active session", () => {
    const checkpointDir = join(workspaceRoot, ".agent-checkpoints");
    mkdirSync(checkpointDir, { recursive: true });
    writeFileSync(join(checkpointDir, "cp-2026-06-05T00-00-00-test.md"), "# Checkpoint", "utf-8");

    const result = migrateLegacyState(workspaceRoot, "sess_checkpoints");
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_checkpoints" });

    expect(result.checkpoints).toBe(1);
    expect(existsSync(join(storage.checkpointsDir, "cp-2026-06-05T00-00-00-test.md"))).toBe(true);
  });
});
