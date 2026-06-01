#!/usr/bin/env node

/**
 * DeepAgents Dev Templates — Main Entry Point
 *
 * Supports multiple modes:
 *   (default)           Start ACP server (stdio transport) — for nuwaclaw/Zed/JetBrains
 *   acp                 Same as default
 *   chat                Start interactive REPL in the terminal
 *   ask "<prompt>"     One-shot prompt
 *   run <file>          Run prompt from a file
 *   --help              Show usage
 *
 * Common flags:
 *   --debug             Enable debug-level logging
 *   --config <path>     Use a custom config file
 *   --prompt <name>     Use a named prompt (e.g., code-assistant)
 *   --system-prompt <s> Override the system prompt text
 *
 * Examples:
 *   npx tsx src/index.ts                        # Start ACP server
 *   npx tsx src/index.ts chat --debug           # Start REPL with debug logging
 *   npx tsx src/index.ts ask "print hello world" # One-shot prompt
 *   npx tsx src/index.ts run prompt.md          # Run prompt from file
 */

import { config as loadDotenv } from "dotenv";
import { bootstrap } from "./runtime/index.js";
import { startRepl } from "./cli/repl.js";
import { runOneShot, runPromptFile } from "./cli/one-shot.js";

loadDotenv();

interface ParsedArgs {
  command: string;
  commandArg?: string;
  debug: boolean;
  acp: boolean;
  configPath?: string;
  promptPath?: string;
  systemPrompt?: string;
  showHelp: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: "acp",
    debug: false,
    acp: true,
    showHelp: false,
  };

  // First non-flag argument is the command
  const positional: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === "--debug") {
      args.debug = true;
      i++;
    } else if (a === "--help" || a === "-h") {
      args.showHelp = true;
      i++;
    } else if (a === "--no-acp") {
      args.acp = false;
      i++;
    } else if (a === "--config" && i + 1 < argv.length) {
      args.configPath = argv[i + 1];
      i += 2;
    } else if (a === "--prompt-file" && i + 1 < argv.length) {
      args.promptPath = argv[i + 1];
      i += 2;
    } else if (a === "--system-prompt" && i + 1 < argv.length) {
      args.systemPrompt = argv[i + 1];
      i += 2;
    } else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    } else {
      positional.push(a);
      i++;
    }
  }

  // First positional is the command
  const first = positional[0];
  if (first === "acp") {
    args.command = "acp";
    args.acp = true;
  } else if (first === "chat") {
    args.command = "chat";
    args.acp = false;
  } else if (first === "ask") {
    args.command = "ask";
    args.acp = false;
    args.commandArg = positional[1];
  } else if (first === "run") {
    args.command = "run";
    args.acp = false;
    args.commandArg = positional[1];
  } else if (first === undefined) {
    // No command → default ACP
  } else {
    // Treat as a one-shot prompt
    args.command = "ask";
    args.acp = false;
    args.commandArg = first;
  }

  return args;
}

const HELP = `
DeepAgents Dev Templates — Multi-mode Entry Point

用法:
  npx tsx src/index.ts [command] [args] [flags]

命令:
  (default)              启动 ACP 服务器（stdio 协议）
  acp                    显式启动 ACP 服务器
  chat                   启动交互式 REPL（终端对话模式）
  ask "<prompt>"         单次提问并打印回答
  run <file>             从文件读取 prompt 并执行

标志:
  --debug                启用 debug 级别日志
  --config <path>        使用自定义配置文件
  --prompt-file <path>   使用自定义系统提示词文件
  --system-prompt <s>    直接指定系统提示词
  --no-acp               禁用 ACP 模式
  --help, -h             显示此帮助

示例:
  npx tsx src/index.ts                        # ACP 服务器
  npx tsx src/index.ts chat --debug           # REPL 调试模式
  npx tsx src/index.ts ask "hello world"      # 单次问答
  npx tsx src/index.ts run prompt.md          # 从文件运行
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.showHelp) {
    console.log(HELP);
    return;
  }

  if (args.debug) {
    process.env.LOG_LEVEL = "debug";
  }

  // Check for required API key
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.warn("\x1b[33m⚠️  警告: 未设置 ANTHROPIC_API_KEY 或 OPENAI_API_KEY\x1b[0m");
    console.warn("\x1b[33m   Agent 将无法调用 LLM。请在 .env 文件中设置至少一个。\x1b[0m\n");
  }

  const cliOptions = {
    configPath: args.configPath,
    promptPath: args.promptPath,
    systemPrompt: args.systemPrompt,
  };

  try {
    switch (args.command) {
      case "acp":
        await bootstrap({ acp: true, debug: args.debug, configPath: args.configPath });
        break;

      case "chat":
        await startRepl(cliOptions);
        break;

      case "ask":
        if (!args.commandArg) {
          console.error("Error: 'ask' requires a prompt argument");
          console.error("Usage: npx tsx src/index.ts ask \"your question\"");
          process.exit(1);
        }
        await runOneShot(args.commandArg, cliOptions);
        break;

      case "run":
        if (!args.commandArg) {
          console.error("Error: 'run' requires a file path");
          console.error("Usage: npx tsx src/index.ts run <prompt-file>");
          process.exit(1);
        }
        await runPromptFile(args.commandArg, cliOptions);
        break;
    }
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

main();
