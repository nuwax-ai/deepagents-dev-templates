#!/usr/bin/env node

/**
 * 人审示例入口 —— 把 StatefulFlow（HITL）插进模板的 surface（acp/cli），surface 完全复用。
 *
 * 用法：
 *   tsx examples/human-in-loop/index.ts review "写一段产品介绍"   # CLI：跑到草稿→等你审
 *   tsx examples/human-in-loop/index.ts review -i                # 交互
 *   tsx examples/human-in-loop/index.ts                          # 启动 ACP 服务
 *
 * ACP 下：agent 发出草稿+问题后 end_turn，你下一条消息即被当作 resume（审阅意见）。
 */

import { config as loadDotenv } from "dotenv";
import { bootstrapFlowAcp } from "../../src/surfaces/acp/server.js";
import { runFlowCli } from "../../src/surfaces/cli/run.js";
import { loadFlowConfig } from "../../src/runtime/config.js";
import { createReviewFlow } from "./graph.js";

const argv = process.argv.slice(2);
const interactive = argv.includes("-i") || argv.includes("--interactive");
const positional = argv.filter((a) => !a.startsWith("-"));
const isCli = positional[0] === "review";
const query = isCli ? positional.slice(1).join(" ") || undefined : undefined;

async function main(): Promise<void> {
  loadDotenv();
  const { appConfig } = loadFlowConfig();
  const flow = createReviewFlow(appConfig);

  if (isCli) {
    await runFlowCli(flow, {
      query,
      interactive,
      usage:
        '用法：\n  tsx examples/human-in-loop/index.ts review "写一段产品介绍"\n  tsx examples/human-in-loop/index.ts review -i\n',
    });
  } else {
    await bootstrapFlowAcp({ executor: flow, appConfig });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
