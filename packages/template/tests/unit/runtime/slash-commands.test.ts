import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeSlashCommand } from "../../../src/runtime/slash-commands.js";
import { appendRuntimeMessage, getRuntimeStorage } from "../../../src/runtime/storage/runtime-storage.js";

const baseCtx = (workspaceRoot: string, sessionId = "sess_current") => ({
  environment: "cli" as const,
  tools: [],
  config: {
    agent: { name: "test-agent" },
    model: { provider: "openai", name: "test-model" },
    platform: {},
    skills: { directories: [] },
  },
  workspaceRoot,
  sessionId,
});

describe("slash-commands", () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "slash-commands-test-"));
    workspaceRoot = join(tmpDir, "workspace");
    mkdirSync(workspaceRoot, { recursive: true });
    process.env.DEEPAGENTS_HOME = join(tmpDir, "home");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("renders a specified durable session with recent messages", () => {
    const storage = getRuntimeStorage({ workspaceRoot, sessionId: "sess_target" });
    appendRuntimeMessage({ role: "user", content: "hello from target" }, storage);

    const result = executeSlashCommand("/session sess_target", baseCtx(workspaceRoot));

    expect(result?.kind).toBe("handled");
    expect(result?.text).toContain("指定会话:");
    expect(result?.text).toContain("Session:     sess_target");
    expect(result?.text).toContain("Messages:    1");
    expect(result?.text).toContain("hello from target");
  });

  // ─── /permissions slash command ──────────────────────────────────────
  // The mode set here affects new ACP sessions only — the running session's
  // permissions.mode is baked in at agent construction. The slash command
  // writes DEEPAGENTS_PERMISSIONS_MODE so the NEXT session picks it up.
  // Tests cover: status (no arg), set (valid arg), and reject (invalid arg).

  it("/permissions with no arg reports current env and usage", () => {
    delete process.env.DEEPAGENTS_PERMISSIONS_MODE;
    const result = executeSlashCommand("/permissions", baseCtx(workspaceRoot));
    expect(result?.kind).toBe("handled");
    expect(result?.text).toContain("Deepagents 权限 mode:");
    expect(result?.text).toContain("当前 env:  (unset → uses config default)");
    expect(result?.text).toContain("/permissions yolo|plan|ask");
  });

  it("/permissions ask sets DEEPAGENTS_PERMISSIONS_MODE and tells user to start a new session", () => {
    delete process.env.DEEPAGENTS_PERMISSIONS_MODE;
    expect(process.env.DEEPAGENTS_PERMISSIONS_MODE).toBeUndefined();

    const result = executeSlashCommand("/permissions ask", baseCtx(workspaceRoot));

    expect(result?.kind).toBe("handled");
    expect(process.env.DEEPAGENTS_PERMISSIONS_MODE).toBe("ask");
    expect(result?.text).toContain("Deepagents 权限 mode 已设为: ask");
    expect(result?.text).toContain("仅新建的 session");
  });

  it("/permissions via the pmode alias behaves identically", () => {
    delete process.env.DEEPAGENTS_PERMISSIONS_MODE;
    const result = executeSlashCommand("/pmode yolo", baseCtx(workspaceRoot));
    expect(result?.kind).toBe("handled");
    expect(process.env.DEEPAGENTS_PERMISSIONS_MODE).toBe("yolo");
  });

  it("/permissions with an invalid mode rejects without mutating env", () => {
    delete process.env.DEEPAGENTS_PERMISSIONS_MODE;
    const result = executeSlashCommand("/permissions turbo", baseCtx(workspaceRoot));
    expect(result?.kind).toBe("handled");
    expect(result?.text).toContain("无效 mode: 'turbo'");
    expect(result?.text).toContain("yolo, plan, ask");
    expect(process.env.DEEPAGENTS_PERMISSIONS_MODE).toBeUndefined();
  });

  it("does not treat absolute filesystem paths as slash commands", () => {
    const macPath = "/Users/apple/workspace/deepagents-dev-templates/examples/thesis-ppt/src";
    const linuxPath = "/home/dev/project/src";
    const spacedPath = "/Users/apple/foo bar/baz";

    expect(executeSlashCommand(macPath, baseCtx(workspaceRoot))).toBeNull();
    expect(executeSlashCommand(linuxPath, baseCtx(workspaceRoot))).toBeNull();
    expect(executeSlashCommand(spacedPath, baseCtx(workspaceRoot))).toBeNull();
  });

  it("still recognizes real slash commands after path guard", () => {
    expect(executeSlashCommand("/help", baseCtx(workspaceRoot))?.kind).toBe("handled");
    expect(executeSlashCommand("/config", baseCtx(workspaceRoot))?.kind).toBe("handled");
    expect(executeSlashCommand("/session sess_target", baseCtx(workspaceRoot))?.kind).toBe("handled");
  });
});
