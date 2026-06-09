/**
 * One-shot CLI for running a single prompt against a DeepAgent.
 *
 * Used by `ask "question"` and `run <file>` subcommands.
 * No interactive loop — just send the prompt and print the response.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createAppAgentAsync } from "@runtime/agent-factory.js";
import { loadConfig, resolveConfiguredWorkspaceRoot } from "@runtime/config/config-loader.js";
import { resolveCliSystemPrompt } from "@runtime/helpers.js";
import { logger } from "@runtime/logger.js";
import {
  appendRuntimeMessage,
  createSessionId,
  ensureSessionState,
  getRuntimeStorage,
  withRuntimeStorageContext,
} from "@runtime/storage/runtime-storage.js";

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
  const initialWorkspaceRoot = options.workspaceRoot || process.cwd();
  const config = loadConfig({ configPath: options.configPath, workspaceRoot: initialWorkspaceRoot });
  const workspaceRoot = resolveConfiguredWorkspaceRoot(config, initialWorkspaceRoot);
  const systemPrompt = resolveCliSystemPrompt({ ...options, workspaceRoot, config });
  const sessionId = process.env.DEEPAGENTS_SESSION_ID || createSessionId("run");
  const storage = getRuntimeStorage({ workspaceRoot, sessionId });
  ensureSessionState(storage, { mode: "one-shot", agent: config.agent.name });

  log.info("Creating agent for one-shot prompt");
  // Pass systemPrompt via sessionConfig so createAppAgent routes it
  // to createDeepAgent's systemPrompt field, NOT as a user message.
  // checkpointer: false — one-shot doesn't provide a thread_id.
  const { agent } = await createAppAgentAsync(config, {
    cwd: workspaceRoot,
    systemPrompt,
  }, { checkpointer: false });

  try {
    appendRuntimeMessage({ role: "user", content: prompt }, storage);
    const response = await withRuntimeStorageContext({ workspaceRoot, sessionId }, () =>
      agent.invoke({
        messages: [{ role: "user" as const, content: prompt }],
      })
    );
    const content = extractContent(response);
    appendRuntimeMessage({ role: "assistant", content }, storage);
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

// ─── Helpers ───────────────────────────────────────────

import { extractContent } from "./extract-content.js";
