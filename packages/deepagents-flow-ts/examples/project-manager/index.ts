#!/usr/bin/env node

/**
 * 项目管理示例入口 —— 把 StatefulFlow（评估循环 + HITL 审批）插进模板 surface（acp/cli）。
 *
 * 用法：
 *   tsx examples/project-manager/index.ts plan "做一个落地页"   # CLI：拆解评估→等你审批
 *   tsx examples/project-manager/index.ts plan -i              # 交互
 *   tsx examples/project-manager/index.ts                      # 启动 ACP 服务
 */

import { config as loadDotenv } from "dotenv";
import { bootstrapFlowAcp } from "../../src/surfaces/acp/server.js";
import { runFlowCli } from "../../src/surfaces/cli/run.js";
import { loadFlowConfig } from "../../src/runtime/flow-config.js";
import { createPMFlow } from "./graph.js";

const argv = process.argv.slice(2);
const interactive = argv.includes("-i") || argv.includes("--interactive");
const positional = argv.filter((a) => !a.startsWith("-"));
const isCli = positional[0] === "plan";
const query = isCli ? positional.slice(1).join(" ") || undefined : undefined;

async function main(): Promise<void> {
  loadDotenv();
  const { appConfig } = loadFlowConfig();
  const flow = createPMFlow(appConfig);

  if (isCli) {
    await runFlowCli(flow, {
      query,
      interactive,
      usage:
        '用法：\n  tsx examples/project-manager/index.ts plan "做一个落地页"\n  tsx examples/project-manager/index.ts plan -i\n',
    });
  } else {
    await bootstrapFlowAcp({ executor: flow, appConfig });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
