import { describe, expect, it } from "vitest";
import {
  hasUnresolvedPlaceholder,
  pickEnv,
  resolveSmokeModelEnv,
  resolveSmokePrompts,
} from "../scripts/lib/smoke-env.mjs";

describe("smoke-env", () => {
  it("hasUnresolvedPlaceholder 识别平台占位符", () => {
    expect(hasUnresolvedPlaceholder("{MODEL_PROVIDER_MODEL_NAME}")).toBe(true);
    expect(hasUnresolvedPlaceholder("deepseek-chat")).toBe(false);
  });

  it("pickEnv 忽略占位符", () => {
    const env = { ANTHROPIC_MODEL: "{MODEL_PROVIDER_MODEL_NAME}", OPENAI_MODEL: "deepseek-v4-flash" };
    expect(pickEnv(env, "ANTHROPIC_MODEL")).toBeUndefined();
    expect(pickEnv(env, "OPENAI_MODEL")).toBe("deepseek-v4-flash");
  });

  it("resolveSmokeModelEnv 从 config + .env 解析 openai 模型", () => {
    const flowConfig = { activeFlow: "interview-agent", model: { provider: "openai", name: "deepseek-chat" } };
    const env = {
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "https://api.deepseek.com/v1",
      ANTHROPIC_MODEL: "{MODEL_PROVIDER_MODEL_NAME}",
    };
    const r = resolveSmokeModelEnv(env, flowConfig);
    expect(r.provider).toBe("openai");
    expect(r.modelName).toBe("deepseek-chat");
    expect(r.forward.OPENAI_MODEL).toBe("deepseek-chat");
    expect(r.forward.ANTHROPIC_MODEL).toBeUndefined();
    expect(r.skippedPlaceholderKeys).toContain("ANTHROPIC_MODEL");
    expect(r.activeFlow).toBe("interview-agent");
  });

  it("env OPENAI_MODEL 优先于 config", () => {
    const flowConfig = { model: { provider: "openai", name: "deepseek-chat" } };
    const env = { OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "deepseek-v4-flash" };
    const r = resolveSmokeModelEnv(env, flowConfig);
    expect(r.modelName).toBe("deepseek-v4-flash");
    expect(r.forward.OPENAI_MODEL).toBe("deepseek-v4-flash");
  });

  it("resolveSmokePrompts 支持边界 prompt", () => {
    const prompts = resolveSmokePrompts(
      { SMOKE_PROMPT: "JD+简历...", SMOKE_PROMPT_EDGE: "你是？" },
      "default"
    );
    expect(prompts).toEqual(["JD+简历...", "你是？"]);
  });
});
