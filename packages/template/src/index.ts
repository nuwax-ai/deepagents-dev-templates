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
 *   graph [output]      Generate code relationship graph JSON
 *   --help              Show usage
 *
 * Common flags:
 *   --debug             Enable debug-level logging
 *   --config <path>     Use a custom config file
 *   --prompt <name>     Use a named prompt (e.g., code-assistant)
 *   --system-prompt <s> Override the system prompt text
 *   --cwd <path>        Set the project workspace root
 *
 * Examples:
 *   npx tsx src/index.ts                        # Start ACP server
 *   npx tsx src/index.ts chat --debug           # Start REPL with debug logging
 *   npx tsx src/index.ts ask "print hello world" # One-shot prompt
 *   npx tsx src/index.ts run prompt.md          # Run prompt from file
 *   npx tsx src/index.ts graph graph.json       # Generate code graph
 */

import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { generateCodeGraph, writeCodeGraph } from "./runtime/code-graph.js";
import { bootstrap } from "./surfaces/acp/index.js";
import { startRepl, runOneShot, runPromptFile } from "./surfaces/cli/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// NOTE: loadDotenv() is called inside main().
// In ACP mode, keep model env vars supplied by the host (Zed/JetBrains);
// dotenv is only used as a fallback when the host did not pass credentials.

interface ParsedArgs {
  command: string;
  commandArg?: string;
  debug: boolean;
  acp: boolean;
  configPath?: string;
  promptPath?: string;
  systemPrompt?: string;
  workspaceRoot?: string;
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
    } else if ((a === "--cwd" || a === "--working-dir") && i + 1 < argv.length) {
      args.workspaceRoot = resolve(process.cwd(), argv[i + 1]);
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
  } else if (first === "graph") {
    args.command = "graph";
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
  graph [output.json]    生成代码节点关系图 JSON

标志:
  --debug                启用 debug 级别日志
  --config <path>        使用自定义配置文件
  --prompt-file <path>   使用自定义系统提示词文件
  --system-prompt <s>    直接指定系统提示词
  --cwd <path>           指定项目工作目录
  --no-acp               禁用 ACP 模式
  --help, -h             显示此帮助

示例:
  npx tsx src/index.ts                        # ACP 服务器
  npx tsx src/index.ts chat --debug           # REPL 调试模式
  npx tsx src/index.ts ask "hello world"      # 单次问答
  npx tsx src/index.ts run prompt.md          # 从文件运行
  npx tsx src/index.ts graph                  # 输出节点关系图 JSON
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.showHelp) {
    console.log(HELP);
    return;
  }

  // In ACP mode, load .env as fallback (shell vars were cleaned above).
  // If Zed passes env vars, they'll be in process.env BEFORE loadDotenv,
  // and dotenv won't overwrite them.
  if (!args.acp || (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN && !process.env.OPENAI_API_KEY)) {
    loadDotenv({ path: resolve(PROJECT_ROOT, ".env") });
  }

  // Prefer API-key auth over any inherited Anthropic auth token. Zed passes
  // ANTHROPIC_API_KEY in settings.json, while shell/launcher environments may
  // carry a stale ANTHROPIC_AUTH_TOKEN that the SDK would also send.
  if (process.env.ANTHROPIC_API_KEY) {
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  }

  if (args.debug) {
    process.env.LOG_LEVEL = "debug";
  }

  // Check for required API key
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN && !process.env.OPENAI_API_KEY) {
    console.warn("\x1b[33m⚠️  警告: 未设置 ANTHROPIC_API_KEY、ANTHROPIC_AUTH_TOKEN 或 OPENAI_API_KEY\x1b[0m");
    console.warn("\x1b[33m   Agent 将无法调用 LLM。请在 .env 文件中设置至少一个。\x1b[0m\n");
  }

  const cliOptions = {
    configPath: args.configPath,
    promptPath: args.promptPath,
    systemPrompt: args.systemPrompt,
    workspaceRoot: args.workspaceRoot,
  };

  try {
    switch (args.command) {
      case "acp":
        await bootstrap({ acp: true, debug: args.debug, configPath: args.configPath, workspaceRoot: args.workspaceRoot });
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

      case "graph":
        if (args.commandArg) {
          writeCodeGraph(args.commandArg);
          console.log(`Code graph written to ${args.commandArg}`);
        } else {
          console.log(JSON.stringify(generateCodeGraph(), null, 2));
        }
        break;
    }
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

void main();
