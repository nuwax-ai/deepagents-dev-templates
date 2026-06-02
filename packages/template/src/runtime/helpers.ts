/**
 * Shared Runtime Helpers
 *
 * Common functions used by both agent-factory.ts and acp-server.ts.
 * Extracted to eliminate duplication and provide a single source of truth
 * for agent configuration building.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { type CreateDeepAgentParams, type FilesystemPermission } from "deepagents";
import type { StructuredTool } from "@langchain/core/tools";
import { ChatAnthropic } from "@langchain/anthropic";
import type { AppConfig, ACPSessionConfig } from "./config-loader.js";
import { PlatformClient } from "./platform-client.js";
import { MCPManager } from "./mcp-manager.js";
import { VariableManager } from "./variable-manager.js";
import { createTools, type ToolContext } from "../app/tools/index.js";
import { logger } from "./logger.js";

// ─── Runtime Context ────────────────────────────────────

/**
 * The set of runtime components that tools and the agent depend on.
 * Created once per agent lifecycle (bootstrap or standalone factory call).
 */
export interface RuntimeContext {
  config: AppConfig;
  /** PlatformClient when platform credentials are configured, null in local-only mode */
  platformClient: PlatformClient | null;
  mcpManager: MCPManager;
  variableManager: VariableManager;
  toolContext: ToolContext;
  tools: StructuredTool[];
}

/**
 * Create the runtime context: PlatformClient (optional), MCPManager,
 * VariableManager, the ToolContext that binds them to tools, and the tools array.
 *
 * PlatformClient is OPTIONAL — when both agentId and spaceId are empty,
 * the agent runs in local-only mode. Platform-dependent tools will return
 * clear error messages when invoked.
 */
export function createRuntimeContext(
  config: AppConfig,
  sessionConfig?: ACPSessionConfig
): RuntimeContext {
  const log = logger.child("runtime-context");

  const agentId = config.platform.agentId || sessionConfig?.agentId || "";
  const spaceId = config.platform.spaceId || sessionConfig?.spaceId || "";

  // Platform is optional — only create PlatformClient if both IDs are set
  const hasPlatform = !!(agentId && spaceId);
  const platformClient = hasPlatform
      ? new PlatformClient({
          apiBaseUrl: config.platform.apiBaseUrl,
          agentId,
          spaceId,
          authToken: process.env.PLATFORM_API_TOKEN,
          endpoints: config.platform.endpoints,
        })
    : null;

  if (!hasPlatform) {
    log.info("Platform credentials not provided — running in local-only mode");
  }

  const mcpManager = new MCPManager({
    defaultConfigPath: config.mcp.configPath,
    mergeStrategy: config.mcp.mergeStrategy,
  });

  // Apply session MCP overrides if present
  if (sessionConfig?.mcpServers) {
    mcpManager.setSessionConfig({
      servers: sessionConfig.mcpServers as Record<
        string,
        { command?: string; args?: string[]; url?: string }
      >,
    });
  }

  // VariableManager handles null platformClient (local-only mode)
  const variableManager = new VariableManager({ platformClient: platformClient ?? undefined });

  const toolContext: ToolContext = {
    platformClient,
    mcpManager,
    variableManager,
  };

  // Create tools bound to the runtime context
  const tools = createTools(toolContext);

  log.info("Runtime context created", {
    mode: hasPlatform ? "platform" : "local",
    agentId: agentId || "(none)",
    mcpServers: mcpManager.listServers(),
    tools: tools.length,
  });

  return { config, platformClient, mcpManager, variableManager, toolContext, tools };
}

/**
 * Hydrate async runtime layers that depend on platform APIs.
 *
 * The custom MCP bridge holds a reference to the MCPManager, so it is safe to
 * populate platform MCP config after tool objects are created and before the
 * agent starts processing prompts.
 */
export async function hydrateRuntimeContext(context: RuntimeContext): Promise<RuntimeContext> {
  const log = logger.child("runtime-context");
  if (!context.platformClient) {
    return context;
  }

  try {
    const platformMcp = await context.platformClient.listMcpServers();
    if (Object.keys(platformMcp.servers).length > 0) {
      context.mcpManager.setPlatformConfig(platformMcp);
      log.info("Hydrated platform MCP config", {
        servers: Object.keys(platformMcp.servers),
      });
    }
  } catch (err) {
    log.warn("Failed to hydrate platform MCP config; continuing with default/session MCP only", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return context;
}

export async function createRuntimeContextAsync(
  config: AppConfig,
  sessionConfig?: ACPSessionConfig
): Promise<RuntimeContext> {
  return await hydrateRuntimeContext(createRuntimeContext(config, sessionConfig));
}

// ─── Model ──────────────────────────────────────────────

/** Build the model string deepagents expects: "provider:model-name" */
export function resolveModelString(config: AppConfig): string {
  return `${config.model.provider}:${config.model.name}`;
}

// Cache the model instance to avoid redundant instantiation on repeated calls.
let cachedModel: { key: string; instance: CreateDeepAgentParams["model"] } | null = null;

/** Build the model instance/string accepted by deepagents. */
export function resolveModel(config: AppConfig): CreateDeepAgentParams["model"] {
  if (config.model.provider !== "anthropic") {
    return resolveModelString(config);
  }

  const cacheKey = `${config.model.name}|${config.model.baseUrl ?? ""}|${config.model.settings.temperature}|${config.model.settings.maxTokens ?? ""}`;
  if (cachedModel && cachedModel.key === cacheKey) {
    return cachedModel.instance;
  }

  const apiKey =
    process.env[config.model.authTokenEnv] ||
    process.env[config.model.apiKeyEnv] ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    process.env.ANTHROPIC_API_KEY;

  const instance = new ChatAnthropic({
    model: config.model.name,
    apiKey,
    anthropicApiUrl: config.model.baseUrl,
    temperature: config.model.settings.temperature,
    maxTokens: config.model.settings.maxTokens,
  });
  cachedModel = { key: cacheKey, instance };
  return instance;
}

// ─── System Prompt ──────────────────────────────────────

/**
 * Resolve system prompt with priority chain:
 *   ACP session prompt > prompts/developer-agent.system.md > inline fallback
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

  // Try loading from prompts/developer-agent.system.md
  const promptPath = resolve(workspaceRoot, "prompts/developer-agent.system.md");
  if (existsSync(promptPath)) {
    const content = readFileSync(promptPath, "utf-8");
    // Strip the H1 title line (metadata, not prompt content)
    return content.replace(/^# .*\r?\n/, "").trim();
  }

  // Inline fallback
  return `You are ${config.agent.name} — an AI application agent.

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

/**
 * Resolve system prompt for CLI modes (REPL / one-shot).
 * Priority: explicit text > custom file > default prompt file > generic fallback.
 */
export function resolveCliSystemPrompt(options: {
  systemPrompt?: string;
  promptPath?: string;
}): string {
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

// ─── Memory Files ───────────────────────────────────────

/**
 * Discover AGENTS.md and CLAUDE.md files in the workspace.
 * These are loaded by deepagents' memory system into the system prompt.
 */
export function discoverMemoryFiles(workspaceRoot: string): string[] {
  const candidates = ["AGENTS.md", "CLAUDE.md", ".deepagents/AGENTS.md"];
  const found: string[] = [];
  for (const candidate of candidates) {
    if (existsSync(resolve(workspaceRoot, candidate))) {
      found.push(`./${candidate}`);
    }
  }
  return found;
}

// ─── Skills Paths ───────────────────────────────────────

/**
 * Normalize skills directory paths for deepagents.
 * deepagents expects POSIX paths relative to the backend root.
 */
export function resolveSkillsPaths(config: AppConfig): string[] {
  return config.skills.directories.map((d) =>
    d.startsWith("./") ? d : `./${d}`
  );
}

// ─── Permissions ────────────────────────────────────────

/**
 * Build filesystem permissions for deepagents.
 * Protects denied paths from writes while allowing everything else.
 * deepagents expects absolute glob paths starting with `/`.
 */
export function buildPermissions(config: AppConfig): FilesystemPermission[] {
  const permissions: FilesystemPermission[] = [];

  for (const denied of config.permissions.deniedPaths) {
    const globPath = denied.startsWith("/") ? `${denied}**` : `/${denied}**`;
    permissions.push({
      operations: ["write"],
      paths: [globPath],
      mode: "deny" as const,
    });
  }

  permissions.push({
    operations: ["read", "write"],
    paths: ["/**"],
    mode: "allow" as const,
  });

  return permissions;
}

// ─── Interrupt-On ───────────────────────────────────────

/**
 * Build the interruptOn map for deepagents from the config array.
 * Maps tool names to `true` for human-in-the-loop approval.
 */
export function buildInterruptOn(tools: string[]): Record<string, boolean> {
  const interruptOn: Record<string, boolean> = {};
  for (const toolName of tools) {
    interruptOn[toolName] = true;
  }
  return interruptOn;
}

// ─── Agent Config Parts ─────────────────────────────────

/**
 * Build common agent configuration parts used by both agent-factory and acp-server.
 * Returns an object with all the composed config fields needed for createDeepAgent().
 */
export function buildAgentConfigParts(
  config: AppConfig,
  sessionConfig: ACPSessionConfig | undefined,
  workspaceRoot: string,
  tools: StructuredTool[]
) {
  return {
    model: resolveModel(config),
    systemPrompt: resolveSystemPrompt(config, sessionConfig, workspaceRoot),
    tools,
    skills: resolveSkillsPaths(config),
    memory: discoverMemoryFiles(workspaceRoot).length > 0
      ? discoverMemoryFiles(workspaceRoot)
      : undefined,
    permissions: buildPermissions(config),
    interruptOn: buildInterruptOn(config.permissions.interruptOn),
  };
}
