/**
 * ACP 会话配置合并与 _meta 解析单测。
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  coalesceSystemPromptValue,
  extractSystemPromptFromParams,
  loadSessionConfigFromEnv,
  mergeAcpSessionConfig,
} from "../src/surfaces/acp/session-config.js";

const ENV_KEY = "ACP_SESSION_CONFIG_JSON";

describe("acp-session-config", () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
    delete process.env.SYSTEM_PROMPT;
    delete process.env.AGENT_SYSTEM_PROMPT;
    delete process.env.PLATFORM_SYSTEM_PROMPT;
  });

  it("mergeAcpSessionConfig：env prompt 在 params 缺失时保留", () => {
    const merged = mergeAcpSessionConfig(
      { systemPrompt: "env-prompt", model: "gpt-4o" },
      { cwd: "/w" }
    );
    expect(merged.systemPrompt).toBe("env-prompt");
    expect(merged.model).toBe("gpt-4o");
    expect(merged.cwd).toBe("/w");
  });

  it("extractSystemPromptFromParams：_meta.system_prompt 蛇形命名", () => {
    const r = extractSystemPromptFromParams({
      _meta: { system_prompt: "snake-case-prompt" },
    });
    expect(r).toEqual({ systemPrompt: "snake-case-prompt", source: "params-meta" });
  });

  it("extractSystemPromptFromParams：Claude Code _meta.systemPrompt.append", () => {
    const r = extractSystemPromptFromParams({
      cwd: "/w",
      _meta: { systemPrompt: { type: "preset", preset: "claude_code", append: "我是小帅帅" } },
    });
    expect(r).toEqual({ systemPrompt: "我是小帅帅", source: "params-meta" });
  });

  it("params.system_prompt 蛇形（对齐平台 HTTP body）", () => {
    const r = extractSystemPromptFromParams({
      cwd: "/w",
      system_prompt: "平台 HTTP system_prompt",
    });
    expect(r).toEqual({ systemPrompt: "平台 HTTP system_prompt", source: "params-top-level" });
  });

  it("SYSTEM_PROMPT 环境变量", () => {
    process.env.SYSTEM_PROMPT = "env-system-prompt-text";
    expect(loadSessionConfigFromEnv()?.systemPrompt).toBe("env-system-prompt-text");
  });

  it("loadSessionConfigFromEnv 非法 JSON", () => {
    process.env[ENV_KEY] = "not-json";
    expect(loadSessionConfigFromEnv()).toBeUndefined();
  });
});
