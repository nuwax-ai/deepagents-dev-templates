/**
 * ACP 会话配置诊断单测 —— 验证 env / params 汇总与根因信号字段。
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  loadSessionConfigFromEnv,
  mergeAcpSessionConfig,
  predictSystemPromptSource,
  summarizeAcpSessionParams,
  summarizeMcpServerEntry,
  systemPromptParamSource,
} from "../src/surfaces/acp/session-diagnostics.js";

const ENV_KEY = "ACP_SESSION_CONFIG_JSON";

describe("loadSessionConfigFromEnv", () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it("无 env → undefined", () => {
    expect(loadSessionConfigFromEnv()).toBeUndefined();
  });

  it("合法 JSON → 解析 ACPSessionConfig", () => {
    process.env[ENV_KEY] = JSON.stringify({
      systemPrompt: "你是目标 Agent",
      model: "gpt-4o",
    });
    expect(loadSessionConfigFromEnv()).toEqual({
      systemPrompt: "你是目标 Agent",
      model: "gpt-4o",
    });
  });

  it("非法 JSON → undefined（不抛）", () => {
    process.env[ENV_KEY] = "{not-json";
    expect(loadSessionConfigFromEnv()).toBeUndefined();
  });
});

describe("summarizeAcpSessionParams / systemPromptParamSource", () => {
  it("顶层 systemPrompt", () => {
    const params = { cwd: "/w", systemPrompt: "dev-agent-prompt" };
    expect(systemPromptParamSource(params)).toBe("params-top-level");
    expect(summarizeAcpSessionParams(params)).toMatchObject({
      hasTopLevelSystemPrompt: true,
      topLevelSystemPromptChars: "dev-agent-prompt".length,
    });
  });

  it("configOptions.systemPrompt 别名", () => {
    const params = { cwd: "/w", configOptions: { systemPrompt: "alias-prompt" } };
    expect(systemPromptParamSource(params)).toBe("params-configOptions");
    expect(summarizeAcpSessionParams(params)).toMatchObject({
      hasConfigOptionsSystemPrompt: true,
      configOptionsSystemPromptChars: "alias-prompt".length,
    });
  });

  it("无 systemPrompt", () => {
    expect(systemPromptParamSource({ cwd: "/w" })).toBe("none");
  });

  it("_meta 字段汇总（含 append 对象）", () => {
    const summary = summarizeAcpSessionParams({
      cwd: "/w",
      _meta: { systemPrompt: { append: "meta-p" }, foo: 1 },
    });
    expect(summary).toMatchObject({
      hasMeta: true,
      metaKeys: ["systemPrompt", "foo"],
      hasMetaSystemPrompt: true,
      metaSystemPromptChars: "meta-p".length,
    });
  });
});

describe("mergeAcpSessionConfig", () => {
  it("params 覆盖 env 的 systemPrompt", () => {
    const merged = mergeAcpSessionConfig(
      { systemPrompt: "env", model: "m1" },
      { cwd: "/w", systemPrompt: "params" }
    );
    expect(merged.systemPrompt).toBe("params");
    expect(merged.model).toBe("m1");
  });
});

describe("predictSystemPromptSource", () => {
  it("sessionConfig 有 prompt → acp-session", () => {
    expect(
      predictSystemPromptSource({
        sessionConfig: { systemPrompt: "x" },
        workspaceRoot: "/tmp",
      }).source
    ).toBe("acp-session");
  });

  it("无 session、有 inline → config-inline", () => {
    expect(
      predictSystemPromptSource({
        configInlinePrompt: "inline",
        workspaceRoot: "/tmp",
      }).source
    ).toBe("config-inline");
  });
});

describe("summarizeMcpServerEntry", () => {
  it("stdio: command/args 原样，敏感 arg 值脱敏，env 只记键名", () => {
    expect(
      summarizeMcpServerEntry({
        command: "npx",
        args: ["-y", "@upstash/context7-mcp", "API_KEY=sk-secret"],
        env: { CONTEXT7_KEY: "x", PATH: "/bin" },
      })
    ).toEqual({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp", "API_KEY=***"],
      envKeys: ["CONTEXT7_KEY", "PATH"],
    });
  });

  it("url 敏感 query 参数脱敏，其余保留", () => {
    expect(
      summarizeMcpServerEntry({
        url: "https://x.com/mcp?token=secret&keep=1",
      })
    ).toEqual({
      url: "https://x.com/mcp?token=***&keep=1",
    });
  });

  it("非敏感 url/arg/transport 原样保留", () => {
    expect(
      summarizeMcpServerEntry({
        command: "node",
        args: ["server.js", "--port=3000"],
        url: "https://x.com/mcp",
        transport: "stdio",
      })
    ).toEqual({
      command: "node",
      args: ["server.js", "--port=3000"],
      url: "https://x.com/mcp",
      transport: "stdio",
    });
  });

  it("非对象输入 → kind 标记", () => {
    expect(summarizeMcpServerEntry(undefined)).toEqual({ kind: "undefined" });
    expect(summarizeMcpServerEntry("npx")).toEqual({ kind: "string" });
  });
});
