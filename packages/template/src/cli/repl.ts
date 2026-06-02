/**
 * REPL CLI for running a DeepAgent interactively in the terminal.
 *
 * Uses Node.js native readline — zero extra dependencies.
 * Reuses createAppAgent() from the runtime so behavior is consistent
 * with the ACP server mode.
 *
 * Special commands:
 *   /help     — show available commands
 *   /tools    — list available tools
 *   /config   — show current configuration
 *   /clear    — clear the screen
 *   /save <p> — save conversation history to a JSON file
 *   /exit     — quit (also /quit, Ctrl+D)
 */

import * as readline from "node:readline";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAppAgentAsync } from "../runtime/agent-factory.js";
import { loadConfig } from "../runtime/config-loader.js";
import { resolveCliSystemPrompt } from "../runtime/helpers.js";
import { logger } from "../runtime/logger.js";

const log = logger.child("repl");

export interface ReplOptions {
  /** Path to config file */
  configPath?: string;
  /** Path to a custom system prompt file */
  promptPath?: string;
  /** Pre-set system prompt text (overrides file) */
  systemPrompt?: string;
  /** Workspace root directory */
  workspaceRoot?: string;
}

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

const HELP_TEXT = `
可用命令:
  /help              显示此帮助信息
  /tools             列出当前 Agent 可用的工具
  /config            显示当前配置（模型、平台、技能）
  /clear             清屏
  /save <path>       保存对话历史到 JSON 文件
  /exit 或 /quit     退出 REPL (也可按 Ctrl+D)
`;

/**
 * Start the interactive REPL.
 */
export async function startRepl(options: ReplOptions = {}): Promise<void> {
  const config = loadConfig({ configPath: options.configPath });
  const workspaceRoot = options.workspaceRoot || process.cwd();

  // Resolve system prompt (CLI > file > config defaults)
  const systemPrompt = resolveCliSystemPrompt(options);

  console.log("\n\x1b[36m╔════════════════════════════════════════╗");
  console.log("║   DeepAgents Interactive REPL          ║");
  console.log("╚════════════════════════════════════════╝\x1b[0m");
  console.log(`\x1b[2mAgent: ${config.agent.name} | Model: ${config.model.provider}:${config.model.name}\x1b[0m`);
  console.log(`\x1b[2mWorkspace: ${workspaceRoot}\x1b[0m`);
  console.log(`\x1b[2mMode: ${config.platform.agentId ? "platform" : "local-only"}\x1b[0m`);
  console.log(`\x1b[2mType /help for commands. Press Ctrl+D to exit.\x1b[0m\n`);

  log.info("Creating agent for REPL session");
  // Pass systemPrompt via sessionConfig so createAppAgent routes it
  // to createDeepAgent's systemPrompt field, NOT as a user message.
  const { agent, context } = await createAppAgentAsync(config, {
    cwd: workspaceRoot,
    systemPrompt,
  });

  // Display available tools
  const toolNames = context.tools.map((t) => t.name);
  console.log(`\x1b[2mLoaded ${toolNames.length} tools: ${toolNames.join(", ")}\x1b[0m\n`);

  const history: ConversationTurn[] = [];
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\x1b[32myou>\x1b[0m ",
    terminal: true,
  });

  const cleanup = () => {
    rl.close();
    console.log("\n\x1b[2m再见!\x1b[0m");
    process.exit(0);
  };

  rl.on("close", () => {
    console.log("\n\x1b[2m再见!\x1b[0m");
    process.exit(0);
  });

  rl.on("SIGINT", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    // Handle special commands
    if (input.startsWith("/")) {
      const handled = await handleCommand(input, { context, config, history, workspaceRoot });
      if (handled === "exit") {
        cleanup();
        return;
      }
      rl.prompt();
      return;
    }

    // Send to agent
    try {
      process.stdout.write("\x1b[36m\n");
      const response = await agent.invoke({
        messages: [...messages, { role: "user", content: input }],
      });

      const assistantContent = extractContent(response);
      process.stdout.write("\x1b[0m");

      // Save to history
      const turn: ConversationTurn = {
        role: "user",
        content: input,
        timestamp: new Date().toISOString(),
      };
      const turnA: ConversationTurn = {
        role: "assistant",
        content: assistantContent,
        timestamp: new Date().toISOString(),
      };
      history.push(turn, turnA);
      messages.push(
        { role: "user", content: input },
        { role: "assistant", content: assistantContent }
      );

      console.log("\n");
    } catch (err) {
      process.stdout.write("\x1b[0m");
      console.error(`\x1b[31mError: ${err instanceof Error ? err.message : String(err)}\x1b[0m\n`);
    }

    rl.prompt();
  });
}

// ─── Helpers ────────────────────────────────────────────

/**
 * Handle a slash command. Returns "exit" if the user wants to quit.
 */
async function handleCommand(
  cmd: string,
  ctx: {
    context: { tools: Array<{ name: string; description?: string }> };
    config: { agent: { name: string; description: string }; model: { provider: string; name: string }; platform: { agentId: string }; skills: { directories: string[] } };
    history: ConversationTurn[];
    workspaceRoot: string;
  }
): Promise<string | void> {
  const [name, ...args] = cmd.split(/\s+/);
  const arg = args.join(" ");

  switch (name) {
    case "/help":
    case "/?":
      console.log(HELP_TEXT);
      return;

    case "/tools":
      console.log("\n可用工具:");
      for (const tool of ctx.context.tools) {
        const desc = tool.description?.split("\n")[0]?.slice(0, 80) || "(no description)";
        console.log(`  \x1b[33m${tool.name}\x1b[0m — ${desc}`);
      }
      console.log();
      return;

    case "/config":
      console.log("\n当前配置:");
      console.log(`  Agent:    ${ctx.config.agent.name}`);
      console.log(`  Model:    ${ctx.config.model.provider}:${ctx.config.model.name}`);
      console.log(`  Platform: ${ctx.config.platform.agentId || "(local-only mode)"}`);
      console.log(`  Skills:   ${ctx.config.skills.directories.join(", ")}`);
      console.log(`  Workspace: ${ctx.workspaceRoot}`);
      console.log();
      return;

    case "/clear":
      console.clear();
      return;

    case "/save":
      if (!arg) {
        console.log("\x1b[31mError: /save requires a file path\x1b[0m");
        return;
      }
      saveHistory(ctx.history, arg);
      return;

    case "/exit":
    case "/quit":
      return "exit";

    default:
      console.log(`\x1b[31mUnknown command: ${name}\x1b[0m — type /help for available commands`);
      return;
  }
}


/**
 * Extract text content from an agent invoke response.
 * Handles various response formats from different deepagents versions.
 */
function extractContent(response: unknown): string {
  if (!response) return "(no response)";

  // Try common response shapes
  if (typeof response === "string") return response;

  // LangChain message array response
  if (Array.isArray(response)) {
    return response
      .map((m: unknown) => extractContent(m))
      .filter(Boolean)
      .join("\n");
  }

  // Object with messages array
  const r = response as { messages?: unknown[]; content?: unknown; text?: unknown };
  if (Array.isArray(r.messages)) {
    return r.messages
      .map((m: unknown) => extractContent(m))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof r.content === "string") return r.content;
  if (typeof r.text === "string") return r.text;

  // Array of content blocks
  if (Array.isArray(r.content)) {
    return r.content
      .map((b: unknown) => {
        if (typeof b === "string") return b;
        const block = b as { type?: string; text?: string };
        if (block.type === "text" && typeof block.text === "string") return block.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  // Fallback: stringify
  try {
    return JSON.stringify(response, null, 2);
  } catch {
    return String(response);
  }
}

/**
 * Save conversation history to a JSON file.
 */
function saveHistory(history: ConversationTurn[], filePath: string): void {
  const fullPath = resolve(process.cwd(), filePath);
  const data = {
    savedAt: new Date().toISOString(),
    turnCount: history.length,
    turns: history,
  };
  writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`\x1b[32mSaved ${history.length} turns to ${fullPath}\x1b[0m`);
}
