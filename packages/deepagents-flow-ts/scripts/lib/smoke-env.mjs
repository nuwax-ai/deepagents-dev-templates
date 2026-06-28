/**
 * smoke:acp 用模型 env 解析 —— 与 runtime config-loader 对齐，并过滤未替换的平台占位符。
 *
 * rcoder-cli 子进程可能继承 `{MODEL_PROVIDER_*}` 占位符，直接转发会导致 400 Invalid model。
 * 本模块从 .env + flow-agent.config.json 解析「真实可用」的 provider/model/baseUrl，再传给 rcoder。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 与 src/runtime/config/config-sources.ts 一致 */
export const MODEL_PROVIDER_PLACEHOLDER_RE = /\{MODEL_PROVIDER_[A-Z_]+\}/;

export function hasUnresolvedPlaceholder(value) {
  return typeof value === "string" && value.trim() !== "" && MODEL_PROVIDER_PLACEHOLDER_RE.test(value);
}

/** 取 env 值；空或占位符 → undefined */
export function pickEnv(env, key) {
  const raw = env[key];
  if (raw === undefined || raw === null) return undefined;
  const v = String(raw).trim();
  if (!v || hasUnresolvedPlaceholder(v)) return undefined;
  return v;
}

export function normalizeProvider(value) {
  const n = String(value ?? "").trim().toLowerCase();
  if (n === "anthropic" || n === "openai") return n;
  return null;
}

export function loadFlowAgentConfig(pkgDir) {
  const configPath = join(pkgDir, "config/flow-agent.config.json");
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return null;
  }
}

function resolveExplicitProvider(env) {
  return (
    normalizeProvider(pickEnv(env, "API_PROTOCOL")) ?? normalizeProvider(pickEnv(env, "LLM_PROVIDER"))
  );
}

function inferProviderFromCredentials(env) {
  const hasOpenAI = !!(pickEnv(env, "OPENAI_API_KEY") || pickEnv(env, "OPENAI_BASE_URL"));
  const hasAnthropic = !!(
    pickEnv(env, "ANTHROPIC_API_KEY") ||
    pickEnv(env, "ANTHROPIC_AUTH_TOKEN") ||
    pickEnv(env, "ANTHROPIC_BASE_URL")
  );
  if (hasOpenAI && !hasAnthropic) return "openai";
  if (hasAnthropic && !hasOpenAI) return "anthropic";
  if (hasOpenAI && hasAnthropic && pickEnv(env, "OPENAI_API_KEY")) return "openai";
  return null;
}

/**
 * 解析 smoke 应转发给 rcoder 子进程的模型相关 env。
 * @returns {{ provider, modelName, baseUrl, forward, activeFlow, skippedPlaceholderKeys }}
 */
export function resolveSmokeModelEnv(env, flowConfig) {
  const fileProvider = normalizeProvider(flowConfig?.model?.provider);
  const provider =
    resolveExplicitProvider(env) ?? fileProvider ?? inferProviderFromCredentials(env) ?? "openai";

  const fileModelName =
    typeof flowConfig?.model?.name === "string" ? flowConfig.model.name.trim() : undefined;
  const fileBaseUrl =
    typeof flowConfig?.model?.baseUrl === "string" ? flowConfig.model.baseUrl.trim() : undefined;

  const defaultModel = pickEnv(env, "DEFAULT_MODEL");
  const openaiModel = pickEnv(env, "OPENAI_MODEL");
  const anthropicModel = pickEnv(env, "ANTHROPIC_MODEL");

  let modelName = defaultModel;
  if (!modelName) {
    modelName = provider === "openai" ? openaiModel ?? fileModelName : anthropicModel ?? fileModelName;
  }

  const openaiBase = pickEnv(env, "OPENAI_BASE_URL");
  const anthropicBase = pickEnv(env, "ANTHROPIC_BASE_URL");
  const baseUrl =
    provider === "openai" ? openaiBase ?? fileBaseUrl : anthropicBase ?? fileBaseUrl;

  const skippedPlaceholderKeys = [];
  for (const key of [
    "API_PROTOCOL",
    "LLM_PROVIDER",
    "DEFAULT_MODEL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_MODEL",
    "OPENAI_BASE_URL",
    "OPENAI_API_KEY",
    "LOG_DIR",
    "LOG_LEVEL",
  ]) {
    const raw = env[key];
    if (raw && hasUnresolvedPlaceholder(String(raw))) skippedPlaceholderKeys.push(key);
  }

  const forward = {};
  for (const key of [
    "API_PROTOCOL",
    "LLM_PROVIDER",
    "DEFAULT_MODEL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "OPENAI_API_KEY",
    "LOG_DIR",
    "LOG_LEVEL",
  ]) {
    const v = pickEnv(env, key);
    if (v) forward[key] = v;
  }

  // 显式写入解析结果，覆盖 rcoder 继承的占位符
  forward.LLM_PROVIDER = provider;
  if (modelName) {
    if (provider === "openai") forward.OPENAI_MODEL = modelName;
    else forward.ANTHROPIC_MODEL = modelName;
  }
  if (baseUrl) {
    if (provider === "openai") forward.OPENAI_BASE_URL = baseUrl;
    else forward.ANTHROPIC_BASE_URL = baseUrl;
  }

  return {
    provider,
    modelName,
    baseUrl,
    forward,
    activeFlow: flowConfig?.activeFlow,
    skippedPlaceholderKeys,
  };
}

export function hasSmokeCredential(env) {
  return !!(pickEnv(env, "ANTHROPIC_API_KEY") || pickEnv(env, "ANTHROPIC_AUTH_TOKEN") || pickEnv(env, "OPENAI_API_KEY"));
}

/** 收集要跑的 prompt 列表（主路径 + 可选边界路径） */
export function resolveSmokePrompts(env, defaultPrompt) {
  const primary = env.SMOKE_PROMPT?.trim() || defaultPrompt;
  const prompts = [primary];
  const edge = env.SMOKE_PROMPT_EDGE?.trim();
  if (edge && edge !== primary) prompts.push(edge);
  return prompts;
}
