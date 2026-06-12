#!/usr/bin/env node

/**
 * deepagents-flow-ts — 通用工作流编排模板入口
 *
 * 模式：
 *   (默认) / acp      启动 ACP 服务（stdio）—— 供 nuwaclaw/Zed/JetBrains
 *   flow "<输入>"     命令行跑一次默认 flow（测试用）
 *   flow -i           交互模式
 *
 * 默认图是占位骨架（prepare → act → decide → respond）。完整范例见 examples/rag。
 * 选项：--config <path>  --debug  -h/--help
 */

import { config as loadDotenv } from "dotenv";
import { loadFlowConfig } from "./runtime/config.js";
import { createDefaultExecutor } from "./app/default-flow.js";
import { bootstrapFlowAcp } from "./surfaces/acp/server.js";
import { runFlowCli } from "./surfaces/cli/run.js";

interface ParsedArgs {
  command: "acp" | "flow";
  query?: string;
  configPath?: string;
  debug: boolean;
  interactive: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: "acp",
    debug: false,
    interactive: false,
    help: false,
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--debug") args.debug = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--interactive" || a === "-i") args.interactive = true;
    else if (a === "--config" && argv[i + 1]) args.configPath = argv[++i];
    else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    } else positional.push(a);
  }

  const first = positional[0];
  if (first === "flow") {
    args.command = "flow";
    args.query = positional.slice(1).join(" ") || undefined;
  } else if (first && first !== "acp") {
    args.command = "flow";
    args.query = positional.join(" ");
  }

  return args;
}

const HELP = `deepagents-flow-ts — 通用工作流编排模板

用法:
  deepagents-flow-ts                启动 ACP 服务（默认，stdio）
  deepagents-flow-ts acp            同上
  deepagents-flow-ts flow "<输入>"  命令行跑一次默认 flow
  deepagents-flow-ts flow -i        交互模式

默认图是占位骨架（prepare → act → decide → respond）；完整范例见 examples/rag。

选项:
  --config <path>   指定配置文件（默认 config/flow-agent.config.json）
  --debug           调试日志
  -h, --help        显示帮助
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  // ACP 模式下凭证由 host(Zed/JetBrains) 注入；dotenv 仅作本地兜底。
  loadDotenv();

  const { appConfig } = loadFlowConfig({ configPath: args.configPath });
  const executor = createDefaultExecutor();

  if (args.command === "flow") {
    await runFlowCli(executor, {
      query: args.query,
      interactive: args.interactive,
    });
  } else {
    await bootstrapFlowAcp({ executor, appConfig, debug: args.debug });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
