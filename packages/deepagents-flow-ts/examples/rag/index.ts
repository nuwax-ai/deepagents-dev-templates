#!/usr/bin/env node

/**
 * RAG 示例入口 —— 用 deepagents-flow-ts 的通用 surface 跑一个真实的 RAG 工作流。
 *
 * 这演示了"如何用 flow 模板搭一个真实流程"：
 *   1. 自己写 graph + nodes（见 ./graph.ts、./nodes/）
 *   2. 包装成 FlowExecutor
 *   3. 插进包的 bootstrapFlowAcp / runFlowCli（surface 不变）
 *
 * 用法：
 *   tsx examples/rag/index.ts rag "什么是 LangGraph？"
 *   tsx examples/rag/index.ts rag -i
 *   tsx examples/rag/index.ts                 # 启动 ACP 服务
 */

import { config as loadDotenv } from "dotenv";
import type { FlowExecutor } from "../../src/surfaces/flow-types.js";
import { bootstrapFlowAcp } from "../../src/surfaces/acp/server.js";
import { runFlowCli } from "../../src/surfaces/cli/run.js";
import { loadRagConfig } from "./config.js";
import { buildGraphConfig, formatSourcesFooter } from "./run-rag.js";
import { executeRAG } from "./graph.js";

/** 把 RAG 图包装成通用 FlowExecutor，插进模板的 surface。 */
function buildRagFlow() {
  const loaded = loadRagConfig();
  const graphConfig = buildGraphConfig(loaded);

  const executor: FlowExecutor = async (query, { onToken, onToolCall }) => {
    const res = await executeRAG(query, {
      config: { ...graphConfig },
      callbacks: { onToken, onToolCall },
    });
    return { answer: res.answer, footer: formatSourcesFooter(res) };
  };

  return { executor, appConfig: loaded.appConfig };
}

// 极简参数解析：默认 acp；`rag "<q>"` / `rag -i` 走 CLI
const argv = process.argv.slice(2);
const interactive = argv.includes("-i") || argv.includes("--interactive");
const debug = argv.includes("--debug");
const positional = argv.filter((a) => !a.startsWith("-"));
const isCli = positional[0] === "rag";
const query = isCli ? positional.slice(1).join(" ") || undefined : undefined;

async function main(): Promise<void> {
  // ACP 模式下凭证由 host 注入；dotenv 仅作本地兜底。
  loadDotenv();
  const { executor, appConfig } = buildRagFlow();
  if (isCli) {
    await runFlowCli(executor, {
      query,
      interactive,
      usage:
        '用法：\n  tsx examples/rag/index.ts rag "你的问题"\n  tsx examples/rag/index.ts rag -i\n',
    });
  } else {
    await bootstrapFlowAcp({ executor, appConfig, debug });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
