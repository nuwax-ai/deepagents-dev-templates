/**
 * logger trace 辅助函数 + dynamic level + per-session 日志绑定单测。
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  logger,
  setLogAgent,
  setLogSession,
  getSessionLogPath,
  getEffectiveLogLevel,
  truncateForLog,
  resolveTraceMaxChars,
  formatMessagesForLog,
  formatPayloadForLog,
} from "../src/runtime/logger.js";
import { createFlowHooks } from "../src/surfaces/acp/server.js";
import type { AppConfig } from "../src/runtime/index.js";

const fakeAppConfig = { agent: { name: "test-flow", version: "0.0.0" } } as unknown as AppConfig;

describe("logger trace helpers", () => {
  const saved = {
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOG_TRACE_FULL: process.env.LOG_TRACE_FULL,
    LOG_DIR: process.env.LOG_DIR,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("truncateForLog 尊重 override 上限", () => {
    process.env.LOG_LEVEL = "info";
    expect(truncateForLog("abcdef", 3)).toBe("abc…[+3 chars]");
  });

  it("LOG_TRACE_FULL=1 时不截断", () => {
    process.env.LOG_TRACE_FULL = "1";
    const long = "x".repeat(20_000);
    expect(resolveTraceMaxChars()).toBe(Number.POSITIVE_INFINITY);
    expect(truncateForLog(long)).toBe(long);
  });

  it("formatMessagesForLog 含 role 与 tool_calls", () => {
    const text = formatMessagesForLog([
      {
        _getType: () => "human",
        content: "你好",
      },
      {
        _getType: () => "ai",
        content: "",
        tool_calls: [{ name: "bash", args: { cmd: "ls" } }],
      },
    ]);
    expect(text).toContain("[0] human: 你好");
    expect(text).toContain("tool_calls:");
    expect(text).toContain("bash");
  });

  it("formatPayloadForLog 在 info 级截断对象 JSON", () => {
    process.env.LOG_LEVEL = "info";
    const payload = { data: "y".repeat(1000) };
    const out = formatPayloadForLog(payload);
    expect(out).toContain("[+");
  });
});

describe("logger dynamic level", () => {
  const savedLevel = process.env.LOG_LEVEL;

  afterEach(() => {
    if (savedLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = savedLevel;
  });

  it("运行时改 LOG_LEVEL 后 debug 日志生效", () => {
    process.env.LOG_LEVEL = "error";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.debug("hidden-debug");
    expect(stderr).not.toHaveBeenCalled();

    process.env.LOG_LEVEL = "debug";
    expect(getEffectiveLogLevel()).toBe("debug");
    logger.debug("visible-debug");
    expect(stderr.mock.calls.some((c) => String(c[0]).includes("visible-debug"))).toBe(true);
    stderr.mockRestore();
  });

  it("Logger.block 在 debug 级输出正文", () => {
    process.env.LOG_LEVEL = "debug";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    logger.block("debug", "test-block", "line-one\nline-two");
    const joined = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(joined).toContain("test-block ▼");
    expect(joined).toContain("line-one");
    expect(joined).toContain("test-block ▲");
    stderr.mockRestore();
  });
});

describe("setLogSession", () => {
  const saved = { LOG_LEVEL: process.env.LOG_LEVEL, LOG_DIR: process.env.LOG_DIR };
  const tmpDirs: string[] = [];

  afterEach(() => {
    if (saved.LOG_LEVEL === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = saved.LOG_LEVEL;
    if (saved.LOG_DIR === undefined) delete process.env.LOG_DIR;
    else process.env.LOG_DIR = saved.LOG_DIR;
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("创建 per-session 日志文件并写入", () => {
    const dir = mkdtempSync(join(tmpdir(), "logger-trace-"));
    tmpDirs.push(dir);
    process.env.LOG_DIR = dir;
    process.env.LOG_LEVEL = "info";
    setLogAgent("trace-agent");
    setLogSession("sess_log_test");
    const path = getSessionLogPath("sess_log_test");
    expect(path).toBeDefined();
    expect(path).toContain("sess_log_test");
    logger.info("session-bound-line");
    const content = readFileSync(path!, "utf-8");
    expect(content).toContain("session-bound-line");
  });
});

describe("ACP configureSession session log", () => {
  const savedDir = process.env.LOG_DIR;
  const tmpDirs: string[] = [];

  afterEach(() => {
    if (savedDir === undefined) delete process.env.LOG_DIR;
    else process.env.LOG_DIR = savedDir;
    for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("单 executor 模式 configureSession 仍绑定 session 日志", async () => {
    const dir = mkdtempSync(join(tmpdir(), "acp-log-"));
    tmpDirs.push(dir);
    process.env.LOG_DIR = dir;
    setLogAgent("test-flow");
    const hooks = createFlowHooks({
      executor: async () => ({ answer: "ok" }),
      appConfig: fakeAppConfig,
    });
    const sessionId = "sess_single_log";
    const cfg = await hooks.configureSession!({
      sessionId,
      agentName: "test-flow",
      phase: "new",
      params: { cwd: dir },
    });
    expect(cfg).toBeUndefined();
    expect(getSessionLogPath(sessionId)).toContain(sessionId);
  });
});

describe("session-trace", () => {
  const savedLevel = process.env.LOG_LEVEL;

  afterEach(() => {
    if (savedLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = savedLevel;
  });

  it("traceFlowCallbacks 记录 tool 三态", async () => {
    const { traceFlowCallbacks } = await import("../src/runtime/session-trace.js");
    process.env.LOG_LEVEL = "debug";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const traced = traceFlowCallbacks({
      onToolCall: async () => {
        /* noop */
      },
    });
    await traced.onToolCall?.({
      toolCallId: "tc1",
      toolName: "bash",
      args: { cmd: "ls" },
      status: "in_progress",
    });
    await traced.onToolCall?.({
      toolCallId: "tc1",
      toolName: "bash",
      args: {},
      status: "completed",
      result: "ok",
    });
    const joined = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(joined).toContain("tool bash args");
    expect(joined).toContain("tool bash result");
    stderr.mockRestore();
  });

  it("ACP 周期内 tool/stage 日志带 sessionId 与 promptMs", async () => {
    const { runInAcpPromptCycle, traceFlowCallbacks } = await import(
      "../src/runtime/session-trace.js"
    );
    process.env.LOG_LEVEL = "debug";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await runInAcpPromptCycle(
      { sessionId: "sess_acp_1", startedAt: Date.now(), query: "hi" },
      async () => {
        const traced = traceFlowCallbacks({}, { sessionId: "sess_acp_1" });
        await traced.onToolCall?.({
          toolCallId: "tc2",
          toolName: "search",
          args: { q: "x" },
          status: "in_progress",
        });
      }
    );
    const joined = stderr.mock.calls.map((c) => String(c[0])).join("");
    expect(joined).toContain("sessionId=sess_acp_1");
    expect(joined).toContain("promptMs=");
    stderr.mockRestore();
  });
});
