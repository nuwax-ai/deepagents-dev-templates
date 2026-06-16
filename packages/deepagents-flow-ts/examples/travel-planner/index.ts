#!/usr/bin/env node

/**
 * 旅行规划示例入口 —— 把 StatefulFlow（map-reduce + HITL）插进模板 surface（acp/cli）。
 *
 * 用法：
 *   tsx examples/travel-planner/index.ts plan "东京 3 天 美食优先"   # CLI：并行规划→等你确认
 *   tsx examples/travel-planner/index.ts plan -i                   # 交互
 *   tsx examples/travel-planner/index.ts                           # 启动 ACP 服务
 */

import { config as loadDotenv } from "dotenv";
import { bootstrapFlowAcp } from "../../src/surfaces/acp/server.js";
import { runFlowCli } from "../../src/surfaces/cli/run.js";
import { loadFlowConfig } from "../../src/runtime/flow-config.js";
import { createTravelFlow } from "./graph.js";

const argv = process.argv.slice(2);
const interactive = argv.includes("-i") || argv.includes("--interactive");
const positional = argv.filter((a) => !a.startsWith("-"));
const isCli = positional[0] === "plan";
const query = isCli ? positional.slice(1).join(" ") || undefined : undefined;

async function main(): Promise<void> {
  loadDotenv();
  const { appConfig } = loadFlowConfig();
  const flow = createTravelFlow(appConfig);

  if (isCli) {
    await runFlowCli(flow, {
      query,
      interactive,
      usage:
        '用法：\n  tsx examples/travel-planner/index.ts plan "东京 3 天 美食优先"\n  tsx examples/travel-planner/index.ts plan -i\n',
    });
  } else {
    await bootstrapFlowAcp({ executor: flow, appConfig });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
