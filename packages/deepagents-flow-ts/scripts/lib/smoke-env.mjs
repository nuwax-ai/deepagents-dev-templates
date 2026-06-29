/**
 * smoke:acp 用模型 env 解析 —— 与 runtime config-loader 对齐，并过滤未替换的平台占位符。
 *
 * 优先级（smoke-acp 用 dotenv override:true 加载 .env）：.env > 继承的 standard env
 * （OPENAI_*、ANTHROPIC_*、API_PROTOCOL）> OPENCODE_*（opencode/nuwaxcode 平台下发）>
 * flow-agent.config.json。rcoder 子进程可能继承 `{MODEL_PROVIDER_*}` 占位符，直接转发会 400；
 * 本模块解析「真实可用」的 provider/model/baseUrl 并发 standard 键给 rcoder。
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

/**
 * 剥离平台模型名前缀 openai-compatible/ / anthropic-compatible/。
 * 平台可能下发 ANTHROPIC_MODEL=openai-compatible/deepseek-v4-flash，代理 API 只认裸模型名。
 *
 * @returns {{ modelName: string, providerHint: 'openai' | 'anthropic' | null }}
 */
export function parseCompatibleModelName(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return { modelName: "", providerHint: null };
  const lower = v.toLowerCase();
  if (lower.startsWith("openai-compatible/")) {
    return {
      modelName: v.slice("openai-compatible/".length).trim(),
      providerHint: "openai",
    };
  }
  if (lower.startsWith("anthropic-compatible/")) {
    return {
      modelName: v.slice("anthropic-compatible/".length).trim(),
      providerHint: "anthropic",
    };
  }
  return { modelName: v, providerHint: null };
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
 * opencode(nuwaxcode) 平台下发的 OPENCODE_* env 兜底到 standard 键。
 *
 * standard（OPENAI_*，已含 smoke-acp 的 .env override）优先；未设时用 OPENCODE_* 填充。
 * forward 仍发 standard 键 → rcoder(flow-ts runtime，只认 OPENAI_*、ANTHROPIC_*) 照常读取，
 * 故 smoke 能复用 opencode 配置而不破坏 fidelity（smoke 仍 = runtime 看到的标准键）。
 *
 * NuWaClaw 给 opencode 注入的键（取自 ~/.nuwaclaw/logs）：OPENCODE_MODEL /
 * OPENCODE_OPENAI_API_KEY / OPENCODE_OPENAI_API_BASE（注：API_BASE，非 BASE_URL）。
 * 仅 OpenAI 系，无 ANTHROPIC 变体。
 */
function withOpencodeFallback(env) {
  const merged = { ...env };
  for (const [std, oc] of [
    ["OPENAI_API_KEY", "OPENCODE_OPENAI_API_KEY"],
    ["OPENAI_BASE_URL", "OPENCODE_OPENAI_API_BASE"],
  ]) {
    const v = pickEnv(merged, oc);
    if (v && !pickEnv(merged, std)) merged[std] = v;
  }
  // OPENCODE_MODEL 是 provider 无关模型名 → 兜底到 DEFAULT_MODEL（model 解析最低优先级）
  const ocModel = pickEnv(merged, "OPENCODE_MODEL");
  if (ocModel && !pickEnv(merged, "DEFAULT_MODEL")) merged.DEFAULT_MODEL = ocModel;
  return merged;
}

/**
 * 解析 smoke 应转发给 rcoder 子进程的模型相关 env。
 * @returns {{ provider, modelName, baseUrl, forward, activeFlow, skippedPlaceholderKeys }}
 */
export function resolveSmokeModelEnv(env, flowConfig) {
  env = withOpencodeFallback(env);
  const fileProvider = normalizeProvider(flowConfig?.model?.provider);

  const fileModelName =
    typeof flowConfig?.model?.name === "string" ? flowConfig.model.name.trim() : undefined;
  const fileBaseUrl =
    typeof flowConfig?.model?.baseUrl === "string" ? flowConfig.model.baseUrl.trim() : undefined;

  const defaultModel = pickEnv(env, "DEFAULT_MODEL");
  const openaiModel = pickEnv(env, "OPENAI_MODEL");
  const anthropicModel = pickEnv(env, "ANTHROPIC_MODEL");

  // 与 runtime ENV_MAP 对齐：DEFAULT_MODEL / ANTHROPIC_MODEL / OPENAI_MODEL 都映射到同一
  // model.name，按插入顺序后写覆盖 → OPENAI_MODEL > ANTHROPIC_MODEL > DEFAULT_MODEL > 文件，
  // 与 provider 无关。旧实现让 DEFAULT_MODEL 最高优先 + 按 provider 二选一，会与 runtime 分叉。
  let modelSource = "file";
  let rawModelName = fileModelName;
  if (openaiModel) {
    modelSource = "openai";
    rawModelName = openaiModel;
  } else if (anthropicModel) {
    modelSource = "anthropic";
    rawModelName = anthropicModel;
  } else if (defaultModel) {
    modelSource = "default";
    rawModelName = defaultModel;
  }

  const { modelName: strippedModelName, providerHint: modelProviderHint } = parseCompatibleModelName(
    rawModelName ?? ""
  );
  const modelName = strippedModelName || undefined;

  // providerHint 仅当 model 来自 provider 无关源（DEFAULT_MODEL / OPENCODE 兜底）时参与推断。
  // ANTHROPIC_MODEL=openai-compatible/... 上的前缀是平台路由标记，不代表应切到 openai 族。
  const providerHintFromModel =
    modelSource === "default" ? modelProviderHint : null;

  // 与 runtime inferModelProviderIfUnset（config-sources.ts）对齐：
  // 显式(API_PROTOCOL/LLM_PROVIDER) > 模型前缀 hint（仅 default 源）> 凭证推断 > 文件 provider。
  const provider =
    resolveExplicitProvider(env) ??
    providerHintFromModel ??
    inferProviderFromCredentials(env) ??
    fileProvider ??
    "openai";

  const openaiBase = pickEnv(env, "OPENAI_BASE_URL");
  const anthropicBase = pickEnv(env, "ANTHROPIC_BASE_URL");
  // 同 model.name：OPENAI_BASE_URL 后写胜 > ANTHROPIC_BASE_URL > 文件。
  const baseUrl = openaiBase ?? anthropicBase ?? fileBaseUrl;

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
    "OPENCODE_MODEL",
    "OPENCODE_OPENAI_API_KEY",
    "OPENCODE_OPENAI_API_BASE",
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
  return !!(
    pickEnv(env, "ANTHROPIC_API_KEY") ||
    pickEnv(env, "ANTHROPIC_AUTH_TOKEN") ||
    pickEnv(env, "OPENAI_API_KEY") ||
    pickEnv(env, "OPENCODE_OPENAI_API_KEY")
  );
}

/** 收集要跑的 prompt 列表（主路径 + 可选边界路径） */
export function resolveSmokePrompts(env, defaultPrompt) {
  const primary = env.SMOKE_PROMPT?.trim() || defaultPrompt;
  const prompts = [primary];
  const edge = env.SMOKE_PROMPT_EDGE?.trim();
  if (edge && edge !== primary) prompts.push(edge);
  return prompts;
}
