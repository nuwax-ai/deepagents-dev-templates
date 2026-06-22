/**
 * Model Resolution
 *
 * Builds the chat model instance deepagents expects from the app config.
 * Instances are cached so repeated calls during a single agent lifecycle do not
 * re-instantiate.
 *
 * Note: conversation summarization is handled by deepagents' built-in
 * createSummarizationMiddleware (injected by createDeepAgent), so this module no
 * longer builds a separate summarizer model.
 */

import { type CreateDeepAgentParams } from "deepagents";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { type AppConfig } from "../config/config-loader.js";

/** Build the model string deepagents expects: "provider:model-name" */
export function resolveModelString(config: AppConfig): string {
  return `${config.model.provider}:${config.model.name}`;
}

// Cache the model instance to avoid redundant instantiation on repeated calls.
let cachedModel: { key: string; instance: CreateDeepAgentParams["model"] } | null = null;

/**
 * provider-aware 解析 apiKey：openai 优先 OPENAI_API_KEY，其余（anthropic 系）优先 authToken。
 * 空则返回 ""（不抛错）——requireModel 据此判定缺凭证；cacheKey 含它使 env 后置填充时重建实例。
 */
export function resolveApiKey(config: AppConfig): string {
  if (config.model.provider === "openai") {
    return (
      process.env.OPENAI_API_KEY ||
      process.env[config.model.apiKeyEnv] ||
      process.env[config.model.authTokenEnv] ||
      ""
    );
  }
  return (
    process.env[config.model.authTokenEnv] ||
    process.env[config.model.apiKeyEnv] ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.ANTHROPIC_API_KEY ||
    ""
  );
}

/** Build the model instance/string accepted by deepagents. */
export function resolveModel(config: AppConfig): CreateDeepAgentParams["model"] {
  const cacheKey = `${config.model.provider}:${config.model.name}|${config.model.baseUrl ?? ""}|${config.model.settings.temperature}|${config.model.settings.maxTokens ?? ""}|${resolveApiKey(config)}`;
  if (cachedModel && cachedModel.key === cacheKey) {
    return cachedModel.instance;
  }

  const apiKey = resolveApiKey(config);

  let instance: CreateDeepAgentParams["model"];

  if (config.model.provider === "openai") {
    instance = new ChatOpenAI({
      model: config.model.name,
      apiKey,
      configuration: {
        baseURL: config.model.baseUrl,
      },
      temperature: config.model.settings.temperature,
      maxTokens: config.model.settings.maxTokens,
    }) as unknown as CreateDeepAgentParams["model"];
  } else {
    instance = new ChatAnthropic({
      model: config.model.name,
      apiKey,
      anthropicApiUrl: config.model.baseUrl,
      temperature: config.model.settings.temperature,
      maxTokens: config.model.settings.maxTokens,
      // Anthropic SDK 对非流式请求有 10 分钟硬上限（长任务/慢模型如经 anthropic 协议代理的 glm 会触发
      // "Streaming is required for operations that may take longer than 10 minutes"）。
      // 开启 streaming 后 invoke 仍返回聚合 AIMessage（LangChain 内部聚合 stream），但底层以流式发出，绕过该限制。
      streaming: true,
    });
  }

  cachedModel = { key: cacheKey, instance };
  return instance;
}
