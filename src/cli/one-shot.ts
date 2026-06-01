/**
 * One-shot CLI for running a single prompt against a DeepAgent.
 *
 * Used by `ask "question"` and `run <file>` subcommands.
 * No interactive loop — just send the prompt and print the response.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createAppAgent } from "../runtime/agent-factory.js";
import { loadConfig } from "../runtime/config-loader.js";
import { logger } from "../runtime/logger.js";

const log = logger.child("one-shot");

export interface OneShotOptions {
  /** Path to config file */
  configPath?: string;
  /** Path to a custom system prompt file */
  promptPath?: string;
  /** Pre-set system prompt text */
  systemPrompt?: string;
  /** Workspace root directory */
  workspaceRoot?: string;
}

/**
 * Run a single prompt against an agent and print the response.
 */
export async function runOneShot(
  prompt: string,
  options: OneShotOptions = {}
): Promise<void> {
  const config = loadConfig({ configPath: options.configPath });
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const systemPrompt = resolveSystemPrompt(options);

  log.info("Creating agent for one-shot prompt");
  const { agent } = createAppAgent(config, { cwd: workspaceRoot });

  const messages = [
    { role: "user" as const, content: systemPrompt },
    { role: "user" as const, content: prompt },
  ];

  try {
    const response = await agent.invoke({ messages });
    const content = extractContent(response);
    console.log(content);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Run a prompt from a file.
 */
export async function runPromptFile(
  filePath: string,
  options: OneShotOptions = {}
): Promise<void> {
  const fullPath = resolve(process.cwd(), filePath);
  if (!existsSync(fullPath)) {
    console.error(`Error: prompt file not found: ${fullPath}`);
    process.exit(1);
  }
  const prompt = readFileSync(fullPath, "utf-8").trim();
  await runOneShot(prompt, options);
}

// ─── Helpers (shared with REPL) ─────────────────────────

function resolveSystemPrompt(options: OneShotOptions): string {
  if (options.systemPrompt) {
    return options.systemPrompt;
  }

  if (options.promptPath) {
    const fullPath = resolve(process.cwd(), options.promptPath);
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, "utf-8").replace(/^# .*\r?\n/, "").trim();
    }
  }

  const defaultPath = resolve(process.cwd(), "prompts/developer-agent.system.md");
  if (existsSync(defaultPath)) {
    return readFileSync(defaultPath, "utf-8").replace(/^# .*\r?\n/, "").trim();
  }

  return "You are a helpful DeepAgent assistant. Be concise and action-oriented.";
}

function extractContent(response: unknown): string {
  if (!response) return "(no response)";
  if (typeof response === "string") return response;

  if (Array.isArray(response)) {
    return response
      .map((m) => extractContent(m))
      .filter(Boolean)
      .join("\n");
  }

  const r = response as { messages?: unknown[]; content?: unknown; text?: unknown };
  if (Array.isArray(r.messages)) {
    return r.messages
      .map((m) => extractContent(m))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof r.content === "string") return r.content;
  if (typeof r.text === "string") return r.text;

  if (Array.isArray(r.content)) {
    return r.content
      .map((b) => {
        if (typeof b === "string") return b;
        const block = b as { type?: string; text?: string };
        if (block.type === "text" && typeof block.text === "string") return block.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  try {
    return JSON.stringify(response, null, 2);
  } catch {
    return String(response);
  }
}
