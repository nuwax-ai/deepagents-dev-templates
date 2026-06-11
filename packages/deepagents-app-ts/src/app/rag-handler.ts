/**
 * RAG ACP Handler
 *
 * 拦截用户输入，通过 RAG Graph 流程处理
 * 流程：Query → Rewrite → Retrieve → Prepare → Agent → Response
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { executeRAG, type CreateRAGGraphConfig } from "./graph.js";
import { DEFAULT_RAG_CONFIG } from "./nodes/types.js";
import type { AppConfig } from "../runtime/config/config-loader.js";
import { logger } from "../runtime/logger.js";

/** RAG 处理器配置 */
export interface RAGHandlerConfig {
  enabled: boolean;
  mcpServers: Record<string, any>;
  retrievalTools: string[];
}

/**
 * 从 AppConfig 创建 RAG 配置
 */
export function createRAGHandlerConfig(config: AppConfig): RAGHandlerConfig {
  const mcpServers = config?.mcp?.servers || {};
  const ragConfig = (config as any)?.rag || {};

  return {
    enabled: ragConfig.enabled ?? false,
    mcpServers,
    retrievalTools: ragConfig.retrievalTools || Object.keys(mcpServers),
  };
}

/**
 * 从 rag-agent.config.json 读取 RAG 配置
 */
export function loadRAGConfigFromFile(): RAGHandlerConfig | null {
  try {
    // 尝试多个可能的路径（包括 ACP 模式下的工作目录）
    const possiblePaths = [
      resolve(process.cwd(), "config/rag-agent.config.json"),
      resolve(process.cwd(), "../config/rag-agent.config.json"),
      resolve(process.cwd(), "../../config/rag-agent.config.json"),
      resolve(process.cwd(), "../../../config/rag-agent.config.json"),
      // RAG Agent 项目的固定路径
      "/Users/apple/workspace/deepagents-dev-templates-rag/packages/deepagents-app-ts/config/rag-agent.config.json",
    ];

    for (const configPath of possiblePaths) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        const ragConfig = parsed.rag || {};

        if (ragConfig.enabled) {
          logger.info("Loaded RAG config from file", { path: configPath });
          return {
            enabled: ragConfig.enabled,
            mcpServers: ragConfig.mcpServers || {},
            retrievalTools: ragConfig.retrievalTools || Object.keys(ragConfig.mcpServers || {}),
          };
        }
      } catch {
        // Continue to next path
      }
    }
  } catch (err) {
    logger.debug("Failed to load RAG config from file", { error: String(err) });
  }
  return null;
}

/**
 * RAG 处理器
 *
 * 在 ACP 层拦截用户消息，走 RAG 流程
 */
export class RAGHandler {
  private config: CreateRAGGraphConfig;
  private appConfig: AppConfig;
  private log = logger.child("rag-handler");

  constructor(handlerConfig: RAGHandlerConfig, appConfig: AppConfig) {
    this.appConfig = appConfig;
    this.config = {
      ...DEFAULT_RAG_CONFIG,
      mcpServers: handlerConfig.mcpServers,
      retrievalTools: handlerConfig.retrievalTools,
      appConfig,
    };
    this.log.info("RAG Handler initialized", {
      enabled: handlerConfig.enabled,
      tools: handlerConfig.retrievalTools,
    });
  }

  /**
   * 处理用户查询
   * 返回 null 表示不处理（降级到普通 Agent）
   */
  async handle(
    query: string,
    options?: {
      onToken?: (token: string) => void;
    }
  ): Promise<string | null> {
    if (!this.config.retrievalTools || this.config.retrievalTools.length === 0) {
      this.log.debug("No retrieval tools configured, skipping RAG");
      return null;
    }

    this.log.info("Processing RAG query", { query: query.substring(0, 100) });

    try {
      const response = await executeRAG(query, {
        config: this.config,
        callbacks: options?.onToken
          ? { onToken: options.onToken }
          : undefined,
      });

      // 格式化输出
      let output = response.answer;

      if (response.sources && response.sources.length > 0) {
        output += "\n\n---\n**来源:**\n";
        response.sources.forEach((s, i) => {
          output += `${i + 1}. ${s.title}${s.url ? ` (${s.url})` : ""}\n`;
        });
      }

      this.log.info("RAG completed", {
        intent: response.metadata.intent,
        toolsUsed: response.metadata.tools_used,
        duration: response.metadata.duration_ms,
      });

      return output;
    } catch (error) {
      this.log.error("RAG processing failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null; // 降级到普通 Agent
    }
  }
}

/**
 * 创建 RAG 处理器实例
 */
export function createRAGHandler(config: AppConfig, ragHandlerConfig?: RAGHandlerConfig): RAGHandler | null {
  // 优先使用传入的配置，否则从文件读取
  const handlerConfig = ragHandlerConfig || loadRAGConfigFromFile() || createRAGHandlerConfig(config);

  logger.info("Creating RAG Handler", {
    enabled: handlerConfig.enabled,
    mcpServerCount: Object.keys(handlerConfig.mcpServers).length,
    retrievalTools: handlerConfig.retrievalTools,
  });

  if (!handlerConfig.enabled) {
    logger.debug("RAG disabled in config");
    return null;
  }

  if (Object.keys(handlerConfig.mcpServers).length === 0) {
    logger.warn("No MCP servers configured for RAG");
    return null;
  }

  return new RAGHandler(handlerConfig, config);
}
