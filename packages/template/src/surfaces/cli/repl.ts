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
import { createAppAgentAsync } from "@runtime/agent-factory.js";
import { loadConfig, resolveConfiguredWorkspaceRoot } from "@runtime/config/config-loader.js";
import { resolveCliSystemPrompt } from "@runtime/helpers.js";
import { logger } from "@runtime/logger.js";
import { executeSlashCommand } from "@runtime/slash-commands.js";
import {
  appendRuntimeMessage,
  createSessionId,
  ensureSessionState,
  getRuntimeStorage,
  withRuntimeStorageContext,
} from "@runtime/storage/runtime-storage.js";

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

/**
 * Start the interactive REPL.
 */
export async function startRepl(options: ReplOptions = {}): Promise<void> {
  const initialWorkspaceRoot = options.workspaceRoot || process.cwd();
  const config = loadConfig({ configPath: options.configPath, workspaceRoot: initialWorkspaceRoot });
  const workspaceRoot = resolveConfiguredWorkspaceRoot(config, initialWorkspaceRoot);
  const sessionId = process.env.DEEPAGENTS_SESSION_ID || createSessionId("cli");
  const storage = getRuntimeStorage({ workspaceRoot, sessionId });
  ensureSessionState(storage, { mode: "cli", agent: config.agent.name });

  // Resolve system prompt (CLI > file > config defaults)
  const systemPrompt = resolveCliSystemPrompt({ ...options, workspaceRoot, config });

  console.log("\n\x1b[36m╔════════════════════════════════════════╗");
  console.log("║   DeepAgents Interactive REPL          ║");
  console.log("╚════════════════════════════════════════╝\x1b[0m");
  console.log(`\x1b[2mAgent: ${config.agent.name} | Model: ${config.model.provider}:${config.model.name}\x1b[0m`);
  console.log(`\x1b[2mWorkspace: ${workspaceRoot}\x1b[0m`);
  console.log(`\x1b[2mSession: ${sessionId}\x1b[0m`);
  console.log(`\x1b[2mStorage: ${storage.sessionDir}\x1b[0m`);
  console.log(`\x1b[2mMode: ${config.platform.agentId ? "platform" : "local-only"}\x1b[0m`);
  console.log(`\x1b[2mType /help for commands. Press Ctrl+D to exit.\x1b[0m\n`);

  log.info("Creating agent for REPL session");
  // Pass systemPrompt via sessionConfig so createAppAgent routes it
  // to createDeepAgent's systemPrompt field, NOT as a user message.
  // checkpointer: false — the REPL tracks messages itself and doesn't
  // provide a thread_id, which makes MemorySaver.put throw.
  const { agent, context } = await createAppAgentAsync(config, {
    cwd: workspaceRoot,
    systemPrompt,
  }, { checkpointer: false });

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
      const handled = executeSlashCommand(input, {
        environment: "cli",
        tools: context.tools,
        config,
        workspaceRoot,
        sessionId,
        clearScreen: () => console.clear(),
        saveHistory: (path) => saveHistory(history, path),
      });
      if (handled?.kind === "exit") {
        cleanup();
        return;
      }
      if (handled?.text) {
        console.log(`\n${handled.text}\n`);
      }
      rl.prompt();
      return;
    }

    // Send to agent
    try {
      process.stdout.write("\x1b[36m\n");
      appendRuntimeMessage({ role: "user", content: input }, storage);
      const response = await withRuntimeStorageContext({ workspaceRoot, sessionId }, () =>
        agent.invoke({
          messages: [...messages, { role: "user", content: input }],
        })
      );

      const assistantContent = extractContent(response);
      appendRuntimeMessage({ role: "assistant", content: assistantContent }, storage);
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

import { extractContent } from "./extract-content.js";

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
