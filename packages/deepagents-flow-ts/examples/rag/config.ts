/**
 * RAG 示例的配置加载 —— 复用包的通用 loadFlowConfig，取出顶层 `rag` 块。
 *
 * 演示"示例如何复用模板的 runtime"：标准 AppConfig 走通用加载器，
 * RAG 专属配置放在同一文件的 `rag` 块里，这里单独取出。
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadFlowConfig } from "../../src/runtime/config.js";
import type { AppConfig } from "deepagents-app-ts/runtime";

const EXAMPLE_ROOT = dirname(fileURLToPath(import.meta.url));

/** `rag` 块（字段可缺省，由 buildGraphConfig 补默认值）。 */
export interface RagSettings {
  enabled?: boolean;
  retrievalTools?: string[];
  mcpServers?: Record<string, unknown>;
  rewrite?: { maxKeywords?: number; intentCategories?: string[] };
  retrieve?: { maxResults?: number; timeout_ms?: number; retryCount?: number };
  prepare?: {
    maxContextTokens?: number;
    deduplication?: boolean;
    sortByRelevance?: boolean;
  };
  agent?: {
    streaming?: boolean;
    includeSources?: boolean;
    confidenceThreshold?: number;
  };
}

export interface LoadedRagConfig {
  appConfig: AppConfig;
  rag: RagSettings;
  configPath: string;
}

export function loadRagConfig(opts: { configPath?: string } = {}): LoadedRagConfig {
  const configPath =
    opts.configPath ?? resolve(EXAMPLE_ROOT, "config/rag-agent.config.json");
  const loaded = loadFlowConfig({ configPath });
  const rag = (loaded.raw.rag ?? {}) as RagSettings;
  return { appConfig: loaded.appConfig, rag, configPath: loaded.configPath };
}
