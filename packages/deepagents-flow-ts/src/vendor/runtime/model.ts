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
import { type AppConfig } from "./config/config-loader.js";

/** Build the model string deepagents expects: "provider:model-name" */
export function resolveModelString(config: AppConfig): string {
  return `${config.model.provider}:${config.model.name}`;
}

// Cache the model instance to avoid redundant instantiation on repeated calls.
let cachedModel: { key: string; instance: CreateDeepAgentParams["model"] } | null = null;

/** Build the model instance/string accepted by deepagents. */
export function resolveModel(config: AppConfig): CreateDeepAgentParams["model"] {
  const cacheKey = `${config.model.provider}:${config.model.name}|${config.model.baseUrl ?? ""}|${config.model.settings.temperature}|${config.model.settings.maxTokens ?? ""}`;
  if (cachedModel && cachedModel.key === cacheKey) {
    return cachedModel.instance;
  }

  // Resolve API key with provider-aware priority
  let apiKey: string | undefined;
  if (config.model.provider === "openai") {
    apiKey =
      process.env.OPENAI_API_KEY ||
      process.env[config.model.apiKeyEnv] ||
      process.env[config.model.authTokenEnv] ||
      "";
  } else {
    apiKey =
      process.env[config.model.authTokenEnv] ||
      process.env[config.model.apiKeyEnv] ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      process.env.ANTHROPIC_API_KEY ||
      "";
  }

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
    });
  }

  cachedModel = { key: cacheKey, instance };
  return instance;
}
