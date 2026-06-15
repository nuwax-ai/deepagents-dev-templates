#!/usr/bin/env node

/**
 * 深度研究报告生成器入口 —— 把多阶段 StatefulFlow 插进模板的 surface（acp/cli）。
 *
 * 这是模板里最复杂的示例（多阶段 / 双层 reflection / 并行调研 / 报告后持续会话），
 * 演示真实的长任务编排。
 *
 * 用法：
 *   tsx examples/deep-research/index.ts research "LangGraph 的架构与适用场景"   # CLI：确认主题→确认大纲→报告→持续会话
 *   tsx examples/deep-research/index.ts research -i                            # 交互模式
 *   tsx examples/deep-research/index.ts                                        # 启动 ACP 服务
 *
 * ACP 下：每次 interrupt 后 end_turn，你的下一条消息即被当作同一会话的续跑（一个会话一份研究）。
 * 交互顺序：确认主题 → 确认大纲 → 报告生成 → 持续会话（反复改/补/问，回复「结束」收尾）。
 */

import { config as loadDotenv } from "dotenv";
import { bootstrapFlowAcp } from "../../src/surfaces/acp/server.js";
import { runFlowCli } from "../../src/surfaces/cli/run.js";
import { loadFlowConfig } from "../../src/runtime/config.js";
import { createResearchFlow } from "./graph.js";

const argv = process.argv.slice(2);
const interactive = argv.includes("-i") || argv.includes("--interactive");
const debug = argv.includes("--debug");
// --thread <id>：固定会话 id，长任务可在多次 CLI 调用间续跑（依赖 FileCheckpointSaver 落盘）。
const threadFlagIdx = argv.findIndex((a) => a === "--thread");
const threadId =
  threadFlagIdx >= 0 ? argv[threadFlagIdx + 1] : undefined;
const positional = argv.filter(
  (a, i) => !a.startsWith("-") && i !== threadFlagIdx + 1
);
const isCli = positional[0] === "research";
const query = isCli ? positional.slice(1).join(" ") || undefined : undefined;

async function main(): Promise<void> {
  loadDotenv();
  const { appConfig } = loadFlowConfig();
  const flow = createResearchFlow(appConfig);

  if (isCli) {
    await runFlowCli(flow, {
      query,
      interactive,
      threadId,
      usage:
        '用法：\n  tsx examples/deep-research/index.ts research "LangGraph 的架构与适用场景"\n  tsx examples/deep-research/index.ts research -i\n  tsx examples/deep-research/index.ts research "..." --thread my-task   # 固定会话，可跨次续跑\n',
    });
  } else {
    await bootstrapFlowAcp({ executor: flow, appConfig, debug });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
