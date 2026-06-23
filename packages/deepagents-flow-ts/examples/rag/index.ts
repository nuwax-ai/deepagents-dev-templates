#!/usr/bin/env node

/**
 * RAG 示例入口 —— 用 deepagents-flow-ts 的通用 surface 跑检索增强工作流。
 *
 *   1. 图 + 节点在 libs/topologies/rag（本目录 re-export）
 *   2. createRagFlow → createStatefulFlow（conversational）
 *   3. 插进 bootstrapFlowAcp / runFlowCli
 *
 * 用法：
 *   tsx examples/rag/index.ts rag "什么是 LangGraph？"
 *   tsx examples/rag/index.ts rag -i
 *   tsx examples/rag/index.ts                 # 启动 ACP 服务
 */

import { config as loadDotenv } from "dotenv";
import { bootstrapFlowAcp } from "../../src/surfaces/acp/server.js";
import { runFlowCli } from "../../src/surfaces/cli/run.js";
import { loadRagConfig } from "./config.js";
import { createRagFlow } from "./flow.js";

const argv = process.argv.slice(2);
const interactive = argv.includes("-i") || argv.includes("--interactive");
const debug = argv.includes("--debug");
const positional = argv.filter((a) => !a.startsWith("-"));
const isCli = positional[0] === "rag";
const query = isCli ? positional.slice(1).join(" ") || undefined : undefined;

async function main(): Promise<void> {
  loadDotenv();
  const loaded = loadRagConfig();
  const flow = createRagFlow(loaded);

  if (isCli) {
    await runFlowCli(flow, {
      query,
      interactive,
      usage:
        '用法：\n  tsx examples/rag/index.ts rag "你的问题"\n  tsx examples/rag/index.ts rag -i\n',
    });
  } else {
    await bootstrapFlowAcp({ executor: flow, appConfig: loaded.appConfig, debug });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
