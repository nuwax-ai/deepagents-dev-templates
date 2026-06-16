/**
 * ACP per-session 配置提取单测 —— sessionConfigFromParams / acpMcpToRecord 纯函数。
 *
 * 验证 D 的实质数据流：从 ACP session/new|load 的 raw params 提取 cwd / mcpServers / model，
 * 且 mcpServers 的 array[{name}] 与 record 两种形态都能归一化成 Record<name, cfg>。
 * 无凭证、纯函数、确定性。
 */

import { describe, it, expect } from "vitest";
import { acpMcpToRecord, sessionConfigFromParams } from "../src/surfaces/acp/server.js";

describe("acpMcpToRecord（MCP 形态归一化）", () => {
  it("undefined / null / 非对象 → undefined", () => {
    expect(acpMcpToRecord(undefined)).toBeUndefined();
    expect(acpMcpToRecord(null)).toBeUndefined();
    expect(acpMcpToRecord("not-an-object")).toBeUndefined();
  });

  it("array [{name, command, ...}] → {name: {command, ...}}", () => {
    const r = acpMcpToRecord([
      { name: "ctx7", command: "npx", args: ["-y", "x"] },
      { name: "fs", url: "http://x" },
    ]);
    expect(r).toEqual({
      ctx7: { command: "npx", args: ["-y", "x"] },
      fs: { url: "http://x" },
    });
  });

  it("array 中无 name 项被跳过；全无 name → undefined", () => {
    expect(acpMcpToRecord([{ command: "x" }, { name: "ok", command: "y" }])).toEqual({
      ok: { command: "y" },
    });
    expect(acpMcpToRecord([{ command: "x" }, { url: "y" }])).toBeUndefined();
  });

  it("record 形态 → 原样透传（同一引用）", () => {
    const rec = { ctx7: { command: "npx" } };
    expect(acpMcpToRecord(rec)).toBe(rec);
  });
});

describe("sessionConfigFromParams（cwd / mcpServers / model 提取）", () => {
  it("有 cwd → sessionConfig.cwd + workspaceRoot 都用该 cwd", () => {
    const { sessionConfig, workspaceRoot } = sessionConfigFromParams({ cwd: "/tmp/ws" });
    expect(workspaceRoot).toBe("/tmp/ws");
    expect(sessionConfig.cwd).toBe("/tmp/ws");
    expect(sessionConfig.mcpServers).toBeUndefined();
    expect(sessionConfig.model).toBeUndefined();
  });

  it("无 cwd → 回退 process.cwd()", () => {
    const { sessionConfig, workspaceRoot } = sessionConfigFromParams({});
    expect(workspaceRoot).toBe(process.cwd());
    expect(sessionConfig.cwd).toBe(process.cwd());
  });

  it("cwd + mcpServers(array) + model → 三字段齐全，mcpServers 归一化为 record", () => {
    const { sessionConfig } = sessionConfigFromParams({
      cwd: "/w",
      mcpServers: [{ name: "a", command: "x" }],
      model: "gpt-4o",
    });
    expect(sessionConfig.cwd).toBe("/w");
    expect(sessionConfig.mcpServers).toEqual({ a: { command: "x" } });
    expect(sessionConfig.model).toBe("gpt-4o");
  });

  it("mcpServers(record) → 透传", () => {
    const { sessionConfig } = sessionConfigFromParams({
      cwd: "/w",
      mcpServers: { a: { command: "x" } },
    });
    expect(sessionConfig.mcpServers).toEqual({ a: { command: "x" } });
  });

  it("model 非字符串 → 忽略", () => {
    const { sessionConfig } = sessionConfigFromParams({ cwd: "/w", model: 123 });
    expect(sessionConfig.model).toBeUndefined();
  });

  it("无任何字段 → 仅 cwd 回退，无 mcpServers/model", () => {
    const { sessionConfig } = sessionConfigFromParams({ unrelated: "x" });
    expect(sessionConfig.cwd).toBe(process.cwd());
    expect(Object.keys(sessionConfig)).toEqual(["cwd"]);
  });
});
