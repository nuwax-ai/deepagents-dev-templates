/**
 * RAG CLI — 通过命令行测试 RAG 流程
 *
 * 用法：
 *   npx tsx src/index.ts rag "什么是 LangGraph？"
 *   npx tsx src/index.ts rag --interactive
 */

import { readFileSync } from "node:fs";
import { loadConfig } from "../../runtime/config/config-loader.js";
import { logger } from "../../runtime/logger.js";
import { createRAGHandler, type RAGHandlerConfig } from "../../app/rag-handler.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");

export interface RAGCLIOptions {
  configPath?: string;
  workspaceRoot?: string;
  interactive?: boolean;
}

/**
 * 运行 RAG CLI
 */
export async function runRAGCLI(
  query?: string,
  options: RAGCLIOptions = {}
): Promise<void> {
  const log = logger.child("rag-cli");

  // 加载配置 - 使用 RAG 配置
  const configPath = options.configPath || resolve(PROJECT_ROOT, "config/rag-agent.config.json");
  const config = loadConfig({
    configPath,
    workspaceRoot: options.workspaceRoot || process.cwd(),
  });

  // 直接读取 rag-agent.config.json 获取 rag 配置
  let ragConfig: any = {};
  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    ragConfig = parsed.rag || {};
  } catch (err) {
    log.warn("Failed to read RAG config", { error: String(err) });
  }

  const mcpServers = config?.mcp?.servers || {};

  const handlerConfig: RAGHandlerConfig = {
    enabled: ragConfig.enabled ?? true,
    mcpServers,
    retrievalTools: ragConfig.retrievalTools || Object.keys(mcpServers),
  };

  log.info("RAG Config", {
    enabled: handlerConfig.enabled,
    mcpServers: Object.keys(mcpServers),
    retrievalTools: handlerConfig.retrievalTools,
  });

  const handler = createRAGHandler(config, handlerConfig);

  if (!handler) {
    console.error("❌ RAG Handler 创建失败");
    console.error("请检查配置中 mcp.servers 是否正确配置");
    process.exit(1);
  }

  if (options.interactive) {
    // 交互模式
    console.log("🤖 RAG Agent 交互模式");
    console.log("输入问题，按 Enter 获取回答。输入 'exit' 退出。\n");

    const readline = await import("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askQuestion = () => {
      rl.question("❓ ", async (input) => {
        const q = input.trim();
        if (q === "exit" || q === "quit") {
          console.log("👋 再见！");
          rl.close();
          return;
        }

        if (!q) {
          askQuestion();
          return;
        }

        console.log("\n⏳ 处理中...\n");
        const result = await handler.handle(q);
        if (result) {
          console.log("📝 回答：");
          console.log(result);
        } else {
          console.log("❌ RAG 处理失败");
        }
        console.log("");
        askQuestion();
      });
    };

    askQuestion();
  } else if (query) {
    // 单次查询
    console.log(`❓ 问题：${query}\n`);
    console.log("⏳ 处理中...\n");

    const result = await handler.handle(query);
    if (result) {
      console.log("📝 回答：");
      console.log(result);
    } else {
      console.log("❌ RAG 处理失败");
    }
  } else {
    console.log("用法：");
    console.log("  npx tsx src/index.ts rag \"你的问题\"");
    console.log("  npx tsx src/index.ts rag --interactive");
  }
}
