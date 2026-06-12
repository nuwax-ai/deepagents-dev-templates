/**
 * RAG CLI — 命令行测试工作流图
 *
 * 用法：
 *   tsx src/index.ts rag "什么是 LangGraph？"
 *   tsx src/index.ts rag --interactive
 */

import { createInterface } from "node:readline";
import { logger } from "deepagents-app-ts/runtime";
import { loadRagConfig } from "../../runtime/config.js";
import { executeRAG } from "../../app/graph.js";
import { buildGraphConfig, formatSourcesFooter } from "../../app/run-rag.js";

export interface RagCliOptions {
  configPath?: string;
  interactive?: boolean;
}

export async function runRagCli(
  query?: string,
  options: RagCliOptions = {}
): Promise<void> {
  const log = logger.child("rag-cli");
  const loaded = loadRagConfig({ configPath: options.configPath });
  const graphConfig = buildGraphConfig(loaded);

  log.info("RAG CLI ready", {
    model: `${loaded.appConfig.model.provider}:${loaded.appConfig.model.name}`,
    retrievalTools: graphConfig.retrievalTools,
  });

  const ask = async (q: string): Promise<void> => {
    process.stdout.write(`\n❓ ${q}\n⏳ 处理中...\n\n`);
    const response = await executeRAG(q, { config: { ...graphConfig } });
    process.stdout.write("📝 回答：\n");
    process.stdout.write(response.answer + formatSourcesFooter(response) + "\n");
  };

  if (options.interactive) {
    process.stdout.write("🤖 RAG 工作流交互模式（输入 'exit' 退出）\n");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const loop = () => {
      rl.question("❓ ", async (input) => {
        const q = input.trim();
        if (q === "exit" || q === "quit") {
          rl.close();
          return;
        }
        if (q) await ask(q);
        loop();
      });
    };
    loop();
  } else if (query) {
    await ask(query);
  } else {
    process.stdout.write(
      '用法：\n  tsx src/index.ts rag "你的问题"\n  tsx src/index.ts rag --interactive\n'
    );
  }
}
