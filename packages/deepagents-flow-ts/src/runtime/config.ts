/**
 * RAG 配置加载
 *
 * 单一配置文件 `config/rag-agent.config.json` 同时承载：
 *  - 标准 AppConfig 字段（agent / model / mcp …）→ 交给 app-ts 的 loadConfig 解析
 *    （未知的 `rag` 键会被其 Zod schema 自动剥离）
 *  - 顶层 `rag` 块（图/检索配置）→ 这里单独读原始 JSON 取出
 *
 * 无任何写死路径：配置默认相对包根解析（基于 import.meta.url）。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig, type AppConfig } from "deepagents-app-ts/runtime";

// dist/runtime/config.js → 包根在 ../../
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** `rag` 块（与 RAGConfig 对齐，字段可缺省，由 buildGraphConfig 补默认值） */
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

/** 解析配置文件路径：显式传入优先，否则用包内默认配置。 */
export function resolveRagConfigPath(configPath?: string): string {
  return configPath ?? resolve(PACKAGE_ROOT, "config/rag-agent.config.json");
}

/** 加载 RAG 配置：返回校验后的 AppConfig + 原始 rag 块。 */
export function loadRagConfig(
  opts: { configPath?: string; workspaceRoot?: string } = {}
): LoadedRagConfig {
  const configPath = resolveRagConfigPath(opts.configPath);
  const appConfig = loadConfig({
    configPath,
    workspaceRoot: opts.workspaceRoot ?? process.cwd(),
  });

  let rag: RagSettings = {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as { rag?: RagSettings };
    rag = parsed.rag ?? {};
  } catch {
    // 配置缺失 rag 块时退化为默认（buildGraphConfig 会补全）
    rag = {};
  }

  return { appConfig, rag, configPath };
}
