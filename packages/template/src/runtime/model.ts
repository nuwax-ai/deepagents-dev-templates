/**
 * Model Resolution
 *
 * Builds the chat model instances/strings deepagents expects, plus the
 * summarization-tuned model used by the compaction middleware. Instances are
 * cached so repeated calls during a single agent lifecycle do not re-instantiate.
 */

import { type CreateDeepAgentParams } from "deepagents";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
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

/**
 * Build a chat model used by the compaction middleware for LLM-based summarization.
 * Reuses the same provider/credentials/baseURL as the agent's model, but applies
 * summarization-appropriate settings (temperature 0, bounded maxTokens) so that
 * summaries are deterministic and cheap.
 *
 * Model name: defaults to the agent's model name. Override with
 * `config.compaction.summarizerModel` to use a cheaper model (e.g. Haiku or
 * gpt-4o-mini) for long sessions.
 */
let cachedSummarizer: { key: string; instance: BaseChatModel } | null = null;

export function resolveSummarizerModel(config: AppConfig): BaseChatModel {
  const modelName = config.compaction.summarizerModel ?? config.model.name;
  const cacheKey = `${config.model.provider}:${modelName}|${config.model.baseUrl ?? ""}`;
  if (cachedSummarizer && cachedSummarizer.key === cacheKey) {
    return cachedSummarizer.instance;
  }

  // Reuse the same API key resolution as resolveModel
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

  let instance: BaseChatModel;
  if (config.model.provider === "openai") {
    instance = new ChatOpenAI({
      model: modelName,
      apiKey,
      configuration: { baseURL: config.model.baseUrl },
      temperature: 0,    // deterministic summaries
      maxTokens: 2048,   // bounded output — summaries should be compact
    }) as unknown as BaseChatModel;
  } else {
    instance = new ChatAnthropic({
      model: modelName,
      apiKey,
      anthropicApiUrl: config.model.baseUrl,
      temperature: 0,
      maxTokens: 2048,
    }) as unknown as BaseChatModel;
  }

  cachedSummarizer = { key: cacheKey, instance };
  return instance;
}
