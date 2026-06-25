/**
 * probeFailedStdioServer 单测 —— stdio MCP 连接失败时的根因诊断预检。
 * 验证：失败命令能被抓到（非零退出/spawn 报错），正常命令不误报且不超时。
 */

import { describe, expect, it } from "vitest";
import { probeFailedStdioServer } from "../src/runtime/context/runtime-context.js";

describe("probeFailedStdioServer", () => {
  it("不存在的命令 → 非零退出或 spawn 报错（且不超时）", async () => {
    const result = await probeFailedStdioServer({
      command: "__definitely_no_such_bin_xyz__",
      args: [],
    });
    expect(result.timedOut).toBe(false);
    const failed =
      Boolean(result.spawnError) ||
      (result.exitCode !== null && result.exitCode !== 0);
    expect(failed).toBe(true);
  }, 10000);

  it("正常命令（node --version）→ 零退出、无 stderr、不超时", async () => {
    const result = await probeFailedStdioServer({
      command: "node",
      args: ["--version"],
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderrTail).toBeUndefined();
    expect(result.timedOut).toBe(false);
  }, 10000);
});
