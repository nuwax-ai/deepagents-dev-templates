/**
 * System Prompt & Output Style Resolution
 *
 * Resolves the agent's system prompt across the ACP/config/file priority chain
 * and appends configured output styles. `withRuntimeContextPrompt` is exported
 * for the agent-config builder, which wraps the resolved prompt with runtime
 * workspace context.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { type AppConfig, type ACPSessionConfig } from "./config/config-loader.js";

/**
 * Resolve system prompt with priority chain:
 *   ACP session prompt > config.agent.systemPrompt > config.agent.systemPromptPath > inline fallback
 */
export function resolveSystemPrompt(
  config: AppConfig,
  sessionConfig: ACPSessionConfig | undefined,
  workspaceRoot: string
): string {
  // ACP session prompt takes highest priority
  if (sessionConfig?.systemPrompt) {
    return sessionConfig.systemPrompt;
  }

  if (config.agent.systemPrompt) {
    return withOutputStyle(config.agent.systemPrompt, config, workspaceRoot);
  }

  // Try loading from the configured prompt path.
  const promptPath = resolvePromptPath(config.agent.systemPromptPath, workspaceRoot);
  let basePrompt: string;
  if (existsSync(promptPath)) {
    const content = readFileSync(promptPath, "utf-8");
    // Strip the H1 title line (metadata, not prompt content)
    basePrompt = content.replace(/^# .*\r?\n/, "").trim();
  } else {
    // Inline fallback
    basePrompt = `You are ${config.agent.name} — an AI application agent.

## Workflow
1. Research — understand the task and check available tools
2. Plan — break down into steps using write_todos
3. Implement — execute each step
4. Verify — test and validate results

## Tool Priority (MANDATORY)
1. Platform MCP tools (query via platform_api) — ALWAYS check first
2. Built-in tools (http_request, platform_api, agent_variable, json_utils)
3. deepagents built-in tools (read_file, write_file, edit_file, execute, task)
4. Write custom code (last resort only)

## Rules
- When you need an external API key → create an agent variable
- When you need a tool → search platform plugins first
- Target agent prompts come from ACP — never hardcode them
- Save generated prompts via platform_api(operation: "save_prompt")
`;
  }

  // Append output style if configured
  return withOutputStyle(basePrompt, config, workspaceRoot);
}

/**
 * Resolve system prompt for CLI modes (REPL / one-shot).
 * Priority: explicit text > custom file > default prompt file > generic fallback.
 */
export function resolveCliSystemPrompt(options: {
  systemPrompt?: string;
  promptPath?: string;
  workspaceRoot?: string;
  config?: AppConfig;
}): string {
  if (options.systemPrompt) {
    return options.systemPrompt;
  }

  const workspaceRoot = options.workspaceRoot || process.cwd();
  if (options.promptPath) {
    const fullPath = resolvePromptPath(options.promptPath, workspaceRoot);
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, "utf-8").replace(/^# .*\r?\n/, "").trim();
    }
  }

  if (options.config?.agent.systemPrompt) {
    return options.config.agent.systemPrompt;
  }

  const configuredPath = options.config?.agent.systemPromptPath;
  const defaultPath = resolvePromptPath(configuredPath || "prompts/developer-agent.system.md", workspaceRoot);
  if (existsSync(defaultPath)) {
    return readFileSync(defaultPath, "utf-8").replace(/^# .*\r?\n/, "").trim();
  }

  return "You are a helpful DeepAgent assistant. Be concise and action-oriented.";
}

/**
 * Load an output style file from prompts/styles/{name}.md.
 * Returns the style content (without frontmatter) or empty string if not found.
 */
export function resolveOutputStyle(styleName: string, workspaceRoot: string): string {
  const stylePath = resolve(workspaceRoot, "prompts/styles", `${styleName}.md`);
  if (!existsSync(stylePath)) {
    return "";
  }
  const content = readFileSync(stylePath, "utf-8");
  // Strip YAML frontmatter
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

function withOutputStyle(basePrompt: string, config: AppConfig, workspaceRoot: string): string {
  const style = resolveOutputStyle(config.agent.outputStyle, workspaceRoot);
  return style ? `${basePrompt}\n\n${style}` : basePrompt;
}

export function withRuntimeContextPrompt(basePrompt: string, workspaceRoot: string): string {
  return `${basePrompt}

## Runtime Context
- Effective workspace root: ${workspaceRoot}
- If the user asks for the current workspace directory, project root, cwd, runtime directory, or session location, use the \`runtime_info\` tool or answer from this Runtime Context.
- Do not infer the workspace by listing \`/\`, \`/Users\`, or parent directories.`;
}

function resolvePromptPath(path: string, workspaceRoot: string): string {
  if (path.startsWith("~/")) {
    return resolve(process.env.HOME || "", path.slice(2));
  }
  return path.startsWith("/") ? path : resolve(workspaceRoot, path);
}
