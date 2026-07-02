import { describe, expect, it } from "vitest";
import {
  configureExpectedToolTrace,
  hasSmokeCredential,
  hasUnresolvedPlaceholder,
  parseCompatibleModelName,
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
    const flowConfig = { activeFlow: "router-gate", model: { provider: "openai", name: "deepseek-chat" } };
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
    expect(r.activeFlow).toBe("router-gate");
  });

  it("env OPENAI_MODEL 优先于 config", () => {
    const flowConfig = { model: { provider: "openai", name: "deepseek-chat" } };
    const env = { OPENAI_API_KEY: "sk-test", OPENAI_MODEL: "deepseek-v4-flash" };
    const r = resolveSmokeModelEnv(env, flowConfig);
    expect(r.modelName).toBe("deepseek-v4-flash");
    expect(r.forward.OPENAI_MODEL).toBe("deepseek-v4-flash");
  });

  it("provider：文件=openai 但只有 ANTHROPIC key → 推断成 anthropic（对齐 runtime inferModelProviderIfUnset）", () => {
    // 旧顺序「文件 > 推断」会让此处选 openai 且无 openai key → smoke 崩溃；runtime 凭 key 推断 anthropic 正常跑。
    const flowConfig = { model: { provider: "openai", name: "deepseek-chat" } };
    const env = { ANTHROPIC_API_KEY: "sk-ant" };
    const r = resolveSmokeModelEnv(env, flowConfig);
    expect(r.provider).toBe("anthropic");
    expect(r.forward.LLM_PROVIDER).toBe("anthropic");
  });

  it("model.name：OPENAI_MODEL 后写覆盖 DEFAULT_MODEL（对齐 runtime ENV_MAP last-write-wins）", () => {
    // 旧实现让 DEFAULT_MODEL 最高优先 → 与 runtime 分叉；现按 OPENAI > ANTHROPIC > DEFAULT 对齐。
    const flowConfig = { model: { provider: "openai", name: "deepseek-chat" } };
    const env = { OPENAI_API_KEY: "sk-test", DEFAULT_MODEL: "model-a", OPENAI_MODEL: "model-b" };
    const r = resolveSmokeModelEnv(env, flowConfig);
    expect(r.modelName).toBe("model-b");
  });

  it("resolveSmokePrompts 支持边界 prompt", () => {
    const prompts = resolveSmokePrompts(
      { SMOKE_PROMPT: "JD+简历...", SMOKE_PROMPT_EDGE: "你是？" },
      "default"
    );
    expect(prompts).toEqual(["JD+简历...", "你是？"]);
  });

  it("SMOKE_EXPECT_TOOL 启用专用追踪且不修改现有日志级别", () => {
    const smokeEnv = { forward: { LOG_LEVEL: "info" } };
    expect(configureExpectedToolTrace(smokeEnv, "search")).toBe(true);
    expect(smokeEnv.forward).toEqual({
      LOG_LEVEL: "info",
      SMOKE_TOOL_TRACE: "1",
    });
  });

  // ── 保真测试：锁定「NuwaClaw chat 实际下发的 env」（取自 ~/.nuwaclaw/logs agent_server.env）
  //    权威键集见 config-sources.ts PLATFORM_MODEL_ENV_KEYS。NuwaClaw 只下发与 API_PROTOCOL 匹配的
  //    单家族；API_PROTOCOL 覆盖 config 文件 provider。这些测试防止 smoke-env 与生产解析分叉。

  it("chat env（Anthropic）：API_PROTOCOL 覆盖 config provider=openai，转发 ANTHROPIC 单家族", () => {
    // 对应日志 resolveModelProvider source=API_PROTOCOL provider=anthropic model=deepseek-v4-flash
    const flowConfig = { model: { provider: "openai", name: "deepseek-chat" } };
    const env = {
      API_PROTOCOL: "Anthropic",
      ANTHROPIC_MODEL: "deepseek-v4-flash",
      ANTHROPIC_BASE_URL: "https://test-llm-proxy.nuwax.com/api/proxy/model",
      ANTHROPIC_API_KEY: "ak-test",
      ANTHROPIC_AUTH_TOKEN: "ak-test",
    };
    const r = resolveSmokeModelEnv(env, flowConfig);
    expect(r.provider).toBe("anthropic");
    expect(r.modelName).toBe("deepseek-v4-flash");
    expect(r.baseUrl).toBe("https://test-llm-proxy.nuwax.com/api/proxy/model");
    expect(r.forward.API_PROTOCOL).toBe("Anthropic");
    expect(r.forward.LLM_PROVIDER).toBe("anthropic");
    expect(r.forward.ANTHROPIC_MODEL).toBe("deepseek-v4-flash");
    expect(r.forward.ANTHROPIC_BASE_URL).toBe("https://test-llm-proxy.nuwax.com/api/proxy/model");
    expect(r.forward.ANTHROPIC_API_KEY).toBe("ak-test");
    expect(r.forward.ANTHROPIC_AUTH_TOKEN).toBe("ak-test");
    // NuWaClaw 不下发 OPENAI_*，forward 不应混入
    expect(r.forward.OPENAI_MODEL).toBeUndefined();
  });

  it("chat env（OpenAI）：API_PROTOCOL=OpenAI 转发 OPENAI 单家族", () => {
    const flowConfig = { model: { provider: "openai", name: "deepseek-chat" } };
    const env = {
      API_PROTOCOL: "OpenAI",
      OPENAI_MODEL: "deepseek-chat",
      OPENAI_BASE_URL: "https://test-llm-proxy.nuwax.com/api/proxy/model",
      OPENAI_API_KEY: "sk-test",
    };
    const r = resolveSmokeModelEnv(env, flowConfig);
    expect(r.provider).toBe("openai");
    expect(r.modelName).toBe("deepseek-chat");
    expect(r.forward.OPENAI_MODEL).toBe("deepseek-chat");
    expect(r.forward.OPENAI_BASE_URL).toBe("https://test-llm-proxy.nuwax.com/api/proxy/model");
    expect(r.forward.OPENAI_API_KEY).toBe("sk-test");
    expect(r.forward.ANTHROPIC_MODEL).toBeUndefined();
  });

  it("chat env 占位符未替换（Electron 替换前的原始模板）：过滤 + 标记 skipped，凭证门拒绝", () => {
    // NuWaClaw 原始模板下 {MODEL_PROVIDER_*} 占位符未替换时，smoke 不应把占位符当真值转发。
    const env = {
      API_PROTOCOL: "Anthropic",
      ANTHROPIC_MODEL: "deepseek-v4-flash",
      ANTHROPIC_BASE_URL: "{MODEL_PROVIDER_BASE_URL}",
      ANTHROPIC_API_KEY: "{MODEL_PROVIDER_API_KEY}",
    };
    const r = resolveSmokeModelEnv(env, { model: { provider: "openai" } });
    expect(r.skippedPlaceholderKeys).toEqual(expect.arrayContaining(["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"]));
    // 占位符不进 forward
    expect(r.forward.ANTHROPIC_API_KEY).toBeUndefined();
    expect(r.forward.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it("env 缺 MODEL/BASE_URL 时回落 flowConfig.model（fileModelName/fileBaseUrl 兜底）", () => {
    // .env/NuWaClaw env 都没给 MODEL/BASE_URL 时，flowConfig.model 的 name/baseUrl 作兜底。
    const flowConfig = {
      model: { provider: "openai", name: "deepseek-chat", baseUrl: "https://api.deepseek.com/v1" },
    };
    const env = { OPENAI_API_KEY: "sk-test" };
    const r = resolveSmokeModelEnv(env, flowConfig);
    expect(r.provider).toBe("openai");
    expect(r.modelName).toBe("deepseek-chat");
    expect(r.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(r.forward.OPENAI_MODEL).toBe("deepseek-chat");
    expect(r.forward.OPENAI_BASE_URL).toBe("https://api.deepseek.com/v1");
    expect(r.forward.OPENAI_API_KEY).toBe("sk-test");
  });

  // ── OPENCODE_* 兜底（opencode/nuwaxcode 平台下发的 env，standard 缺失时复用）

  it("OPENCODE_* 兜底：standard 缺失时用 opencode 平台 env 解析，forward 发 standard 键", () => {
    const env = {
      OPENCODE_MODEL: "deepseek-v4-flash",
      OPENCODE_OPENAI_API_KEY: "ak-test",
      OPENCODE_OPENAI_API_BASE: "https://test-llm-proxy.nuwax.com/api/proxy/model",
    };
    const r = resolveSmokeModelEnv(env, { model: { provider: "openai" } });
    expect(r.provider).toBe("openai");
    expect(r.modelName).toBe("deepseek-v4-flash");
    expect(r.baseUrl).toBe("https://test-llm-proxy.nuwax.com/api/proxy/model");
    // forward 仍发 standard 键（rcoder runtime 只认 standard）
    expect(r.forward.OPENAI_MODEL).toBe("deepseek-v4-flash");
    expect(r.forward.OPENAI_BASE_URL).toBe("https://test-llm-proxy.nuwax.com/api/proxy/model");
    expect(r.forward.OPENAI_API_KEY).toBe("ak-test");
    expect(hasSmokeCredential(env)).toBe(true);
  });

  it("standard 优先于 OPENCODE_*（OPENAI_MODEL 覆盖 OPENCODE_MODEL）", () => {
    const env = {
      OPENAI_MODEL: "glm-5.2",
      OPENCODE_MODEL: "deepseek-v4-flash",
      OPENCODE_OPENAI_API_KEY: "ak-test",
    };
    const r = resolveSmokeModelEnv(env, { model: { provider: "openai" } });
    expect(r.modelName).toBe("glm-5.2");
  });

  it("hasSmokeCredential 识别 OPENCODE_OPENAI_API_KEY", () => {
    expect(hasSmokeCredential({ OPENCODE_OPENAI_API_KEY: "ak-test" })).toBe(true);
    expect(hasSmokeCredential({})).toBe(false);
  });

  // ── openai-compatible/ / anthropic-compatible/ 模型前缀剥离

  it("parseCompatibleModelName 大小写不敏感剥离前缀", () => {
    expect(parseCompatibleModelName("openai-compatible/deepseek-v4-flash")).toEqual({
      modelName: "deepseek-v4-flash",
      providerHint: "openai",
    });
    expect(parseCompatibleModelName("OpenAI-Compatible/glm-5.2")).toEqual({
      modelName: "glm-5.2",
      providerHint: "openai",
    });
    expect(parseCompatibleModelName("anthropic-compatible/claude-3")).toEqual({
      modelName: "claude-3",
      providerHint: "anthropic",
    });
    expect(parseCompatibleModelName("deepseek-chat")).toEqual({
      modelName: "deepseek-chat",
      providerHint: null,
    });
  });

  it("ANTHROPIC_MODEL=openai-compatible/... + API_PROTOCOL=Anthropic → 剥离裸名，provider 仍 anthropic", () => {
    const env = {
      API_PROTOCOL: "Anthropic",
      ANTHROPIC_MODEL: "openai-compatible/deepseek-v4-flash",
      ANTHROPIC_BASE_URL: "https://test-llm-proxy.nuwax.com/api/proxy/model",
      ANTHROPIC_API_KEY: "ak-test",
    };
    const r = resolveSmokeModelEnv(env, { model: { provider: "openai", name: "deepseek-chat" } });
    expect(r.provider).toBe("anthropic");
    expect(r.modelName).toBe("deepseek-v4-flash");
    expect(r.forward.ANTHROPIC_MODEL).toBe("deepseek-v4-flash");
    expect(r.forward.OPENAI_MODEL).toBeUndefined();
  });

  it("仅 OPENCODE_MODEL=openai-compatible/... → provider hint 兜底 openai", () => {
    const env = {
      OPENCODE_MODEL: "openai-compatible/deepseek-v4-flash",
      OPENCODE_OPENAI_API_KEY: "ak-test",
      OPENCODE_OPENAI_API_BASE: "https://test-llm-proxy.nuwax.com/api/proxy/model",
    };
    const r = resolveSmokeModelEnv(env, { model: { provider: "openai" } });
    expect(r.provider).toBe("openai");
    expect(r.modelName).toBe("deepseek-v4-flash");
    expect(r.forward.OPENAI_MODEL).toBe("deepseek-v4-flash");
  });

  it("无 API_PROTOCOL 时 ANTHROPIC_MODEL=openai-compatible/... 不因前缀 hint 误选 openai", () => {
    const env = {
      ANTHROPIC_MODEL: "openai-compatible/deepseek-v4-flash",
      ANTHROPIC_BASE_URL: "https://test-llm-proxy.nuwax.com/api/proxy/model",
      ANTHROPIC_API_KEY: "ak-test",
    };
    const r = resolveSmokeModelEnv(env, { model: { provider: "openai", name: "deepseek-chat" } });
    expect(r.provider).toBe("anthropic");
    expect(r.modelName).toBe("deepseek-v4-flash");
    expect(r.forward.ANTHROPIC_MODEL).toBe("deepseek-v4-flash");
    expect(r.forward.OPENAI_MODEL).toBeUndefined();
  });
});
