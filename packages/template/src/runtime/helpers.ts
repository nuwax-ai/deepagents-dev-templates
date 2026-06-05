/**
 * Shared Runtime Helpers
 *
 * Common functions used by both agent-factory.ts and acp-server.ts.
 * Extracted to eliminate duplication and provide a single source of truth
 * for agent configuration building.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { type CreateDeepAgentParams, type FilesystemPermission, type AnyBackendProtocol, createMemoryMiddleware } from "deepagents";
import type { StructuredTool } from "@langchain/core/tools";
import type { AgentMiddleware } from "langchain";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import type { AppConfig, ACPSessionConfig } from "./config-loader.js";
import { PlatformClient } from "./platform-client.js";
import { MCPManager } from "./mcp-manager.js";
import { VariableManager } from "./variable-manager.js";
import { createTools, type ToolContext } from "../app/tools/index.js";
import { logger } from "./logger.js";
import { createStuckLoopMiddleware } from "./middleware/stuck-loop.js";
import { createPeriodicReminderMiddleware } from "./middleware/periodic-reminder.js";
import { createCostTrackingMiddleware } from "./middleware/cost-tracking.js";
import { createFsPathResolver } from "./middleware/fs-path-resolver.js";
import { createCompactionMiddleware } from "./middleware/compaction.js";
import { createEvictionMiddleware } from "./middleware/eviction.js";
import { createHookMiddleware, getHooks, registerConfiguredHooks } from "../app/hooks/index.js";

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
    defaultConfig: {
      servers: config.mcp.servers as Record<string, { command?: string; args?: string[]; url?: string }>,
    },
    defaultConfigPath: config.mcp.configPath,
    defaultConfigPaths: config.mcp.configPaths,
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
  const cacheKey = `${config.model.provider}:${config.model.name}|${config.model.baseUrl ?? ""}|${config.model.settings.temperature}|${config.model.settings.maxTokens ?? ""}`;
  if (cachedModel && cachedModel.key === cacheKey) {
    return cachedModel.instance;
  }

  // Resolve API key with provider-aware priority
  let apiKey: string | undefined;
  if (config.model.provider === "openai") {
    apiKey =
      process.env.OPENAI_API_KEY ||
      process.env[config.model.apiKeyEnv] ||
      process.env[config.model.authTokenEnv] ||
      "";
  } else {
    apiKey =
      process.env[config.model.authTokenEnv] ||
      process.env[config.model.apiKeyEnv] ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      process.env.ANTHROPIC_API_KEY ||
      "";
  }

  let instance: CreateDeepAgentParams["model"];

  if (config.model.provider === "openai") {
    instance = new ChatOpenAI({
      model: config.model.name,
      apiKey,
      configuration: {
        baseURL: config.model.baseUrl,
      },
      temperature: config.model.settings.temperature,
      maxTokens: config.model.settings.maxTokens,
    }) as unknown as CreateDeepAgentParams["model"];
  } else {
    instance = new ChatAnthropic({
      model: config.model.name,
      apiKey,
      anthropicApiUrl: config.model.baseUrl,
      temperature: config.model.settings.temperature,
      maxTokens: config.model.settings.maxTokens,
    });
  }

  cachedModel = { key: cacheKey, instance };
  return instance;
}

// ─── System Prompt ──────────────────────────────────────

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

// ─── Output Styles ──────────────────────────────────────

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

function resolvePromptPath(path: string, workspaceRoot: string): string {
  if (path.startsWith("~/")) {
    return resolve(process.env.HOME || "", path.slice(2));
  }
  return path.startsWith("/") ? path : resolve(workspaceRoot, path);
}

// ─── Memory Files ───────────────────────────────────────

/**
 * Discover AGENTS.md and CLAUDE.md files in the workspace.
 * These are loaded by deepagents' memory system into the system prompt.
 */
export function discoverMemoryFiles(workspaceRoot: string, includeWorkspaceInstructions = true): string[] {
  if (!includeWorkspaceInstructions) {
    return [];
  }

  const candidates = [
    "AGENTS.md",
    "CLAUDE.md",
    ".deepagents/AGENTS.md",  // legacy path (backward compat)
    ".deepagents/agent.md",   // deepagents standard path
  ];
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
 *
 * Includes:
 * 1. Built-in skill directories from config.skills.directories
 * 2. Skills from each configured agentsDirectory (via <dir>/skills/)
 */
export function resolveSkillsPaths(config: AppConfig): string[] {
  const paths = config.skills.directories.map(normalizeResourcePath);

  // Append skills from .agents directories
  for (const agentsDir of config.agentsDirectories) {
    const normalized = normalizeResourcePath(agentsDir);
    const skillsDir = `${normalized}/skills`;
    paths.push(skillsDir);
  }

  return Array.from(new Set(paths));
}

function normalizeResourcePath(path: string): string {
  if (path === "~/.deepagents") {
    return resolve(process.env.DEEPAGENTS_HOME || resolve(homedir(), ".deepagents"));
  }
  if (path.startsWith("~/.deepagents/")) {
    return resolve(process.env.DEEPAGENTS_HOME || resolve(homedir(), ".deepagents"), path.slice("~/.deepagents/".length));
  }
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  if (path.startsWith("/") || path.startsWith("./")) {
    return path;
  }
  return `./${path}`;
}

// ─── Subagent Discovery ─────────────────────────────────

/** Parsed subagent definition from an AGENT.md file */
export interface DiscoveredSubAgent {
  name: string;
  description: string;
  systemPrompt: string;
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns { frontmatter, body } where frontmatter is a plain object.
 * Supports simple string values and multi-line values (continuation lines starting with whitespace).
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter: Record<string, string> = {};
  let currentKey: string | null = null;

  for (const rawLine of match[1]!.split("\n")) {
    const line = rawLine.replace(/\r$/, "");

    // Multi-line continuation: indented line appends to previous key
    if (currentKey && (line.startsWith("  ") || line.startsWith("\t"))) {
      frontmatter[currentKey] += ` ${line.trim()}`;
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) {
      currentKey = null;
      continue;
    }

    const key = line.slice(0, colonIdx).trim();
    if (!key) {
      currentKey = null;
      continue;
    }

    let value = line.slice(colonIdx + 1).trim();
    // Strip surrounding quotes (quoted values preserve # literally)
    const isQuoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) {
      value = value.slice(1, -1);
    } else {
      // Strip inline YAML comments only for unquoted values.
      // YAML spec: comment starts with # preceded by a space.
      // Avoid stripping '#' that's part of the value (e.g. "C# toolkit", "item #1").
      // Match " #comment" or " # comment" but NOT " C#" or " #1".
      const commentMatch = value.match(/ #(?=$| )/);
      if (commentMatch && commentMatch.index !== undefined && commentMatch.index > 0) {
        value = value.slice(0, commentMatch.index).trim();
      }
    }

    frontmatter[key] = value;
    currentKey = key;
  }

  return { frontmatter, body: match[2]!.trim() };
}

/**
 * Discover subagents from configured .agents/agents/ directories.
 *
 * Convention: each subagent is a subdirectory containing an AGENT.md file
 * with YAML frontmatter (name, description) and a body (systemPrompt).
 *
 * @example
 * .agents/agents/researcher/AGENT.md:
 *   ---
 *   name: researcher
 *   description: "Deep research assistant"
 *   ---
 *   You are a research assistant specialized in...
 */
export function discoverSubAgents(config: AppConfig, workspaceRoot?: string): DiscoveredSubAgent[] {
  const subagents: DiscoveredSubAgent[] = [];
  const log = logger.child("subagent-discovery");
  const root = workspaceRoot || process.cwd();

  for (const agentsDir of config.agentsDirectories) {
    const normalized = normalizeResourcePath(agentsDir);
    const agentsPath = resolve(root, normalized, "agents");

    if (!existsSync(agentsPath)) {
      log.debug("No agents/ directory found", { path: agentsPath });
      continue;
    }

    let entries: string[];
    try {
      entries = readdirSync(agentsPath, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      log.warn("Failed to read agents directory", { path: agentsPath });
      continue;
    }

    for (const entry of entries) {
      const agentMdPath = join(agentsPath, entry, "AGENT.md");
      if (!existsSync(agentMdPath)) {
        log.debug("No AGENT.md found in agent directory", { dir: entry });
        continue;
      }

      try {
        const content = readFileSync(agentMdPath, "utf-8");
        const { frontmatter, body } = parseFrontmatter(content);

        const name = frontmatter.name || entry;
        const description = frontmatter.description || `Subagent: ${name}`;

        if (!body) {
          log.warn("AGENT.md has no body (systemPrompt)", { path: agentMdPath });
          continue;
        }

        subagents.push({ name, description, systemPrompt: body });
        log.info("Discovered subagent", { name, source: agentMdPath });
      } catch (err) {
        log.warn("Failed to parse AGENT.md", {
          path: agentMdPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return subagents;
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
    // Ensure path ends with / before appending ** to avoid matching sibling prefixes
    const base = denied.endsWith("/") ? denied : `${denied}/`;
    const globPath = base.startsWith("/") ? `${base}**` : `/${base}**`;
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
 *
 * @param backend - FilesystemBackend for memory/skills middleware. Required for
 *                  addCacheControl and explicit memory middleware creation.
 */
export function buildAgentConfigParts(
  config: AppConfig,
  sessionConfig: ACPSessionConfig | undefined,
  workspaceRoot: string,
  tools: StructuredTool[],
  backend?: AnyBackendProtocol
) {
  // Build custom middleware array from config
  const middleware: AgentMiddleware[] = [];
  const mwConfig = config.middleware;
  registerConfiguredHooks(config.hooks, workspaceRoot);

  // Memory middleware — explicitly created with addCacheControl for Anthropic prompt caching.
  // Falls back to the `memory` shortcut parameter when no backend is provided.
  const memoryPaths = discoverMemoryFiles(workspaceRoot, config.agent.includeWorkspaceInstructions);
  if (backend && memoryPaths.length > 0) {
    middleware.push(createMemoryMiddleware({
      backend,
      sources: memoryPaths,
      addCacheControl: config.memory.addCacheControl && config.model.provider === "anthropic",
    }));
  }

  if (mwConfig.stuckLoopDetection.enabled) {
    middleware.push(createStuckLoopMiddleware({
      threshold: mwConfig.stuckLoopDetection.threshold,
      mode: mwConfig.stuckLoopDetection.mode,
    }));
  }

  // Resolve workspace-relative paths ("/test.txt") to absolute paths for ACP clients
  middleware.push(createFsPathResolver(workspaceRoot));

  if (mwConfig.periodicReminder.enabled) {
    middleware.push(createPeriodicReminderMiddleware({
      firstAt: mwConfig.periodicReminder.firstAt,
      every: mwConfig.periodicReminder.every,
    }));
  }

  if (mwConfig.costTracking.enabled) {
    middleware.push(createCostTrackingMiddleware({
      warnAtTokens: mwConfig.costTracking.warnAtTokens,
    }));
  }

  // Context compaction — compress old messages when approaching context limit
  if (config.compaction.enabled) {
    middleware.push(createCompactionMiddleware({
      config: config.compaction,
      modelName: config.model.name,
    }));
  }

  // Large output eviction — write oversized tool results to backend
  if (config.eviction.enabled && backend) {
    middleware.push(createEvictionMiddleware({
      config: config.eviction,
      backend: backend as unknown as { write(path: string, content: string): Promise<void> },
    }));
  }

  // Hooks middleware — always included when hooks are registered.
  // Note: hooks registry is module-level (shared across agents in the same process).
  if (getHooks("pre_tool_use").length > 0 || getHooks("post_tool_use").length > 0 ||
      getHooks("before_model").length > 0 || getHooks("after_model").length > 0) {
    middleware.push(createHookMiddleware());
  }

  // Discover subagents from .agents/agents/ directories
  const discoveredSubAgents = discoverSubAgents(config, workspaceRoot);

  // ── Mode-based overrides ─────────────────────────────────
  const mode = config.permissions.mode;
  let interruptOn: Record<string, boolean>;
  let permissions: FilesystemPermission[];
  let systemPrompt = resolveSystemPrompt(config, sessionConfig, workspaceRoot);

  if (mode === "yolo") {
    // No HITL, no path restrictions
    interruptOn = {};
    permissions = [{ operations: ["read", "write"], paths: ["/**"], mode: "allow" as const }];
  } else if (mode === "plan") {
    // HITL on writes + planning preamble
    interruptOn = buildInterruptOn(config.permissions.interruptOn);
    permissions = buildPermissions(config);
    const planPreamble = `## Planning Mode
Before making any changes, you MUST:
1. Present a clear plan of what you intend to do
2. Wait for user approval
3. Only then proceed with execution

`;
    systemPrompt = planPreamble + systemPrompt;
  } else {
    // "ask" — default: HITL on writes
    interruptOn = buildInterruptOn(config.permissions.interruptOn);
    permissions = buildPermissions(config);
  }

  return {
    model: resolveModel(config),
    systemPrompt,
    tools,
    skills: resolveSkillsPaths(config),
    // When backend is provided, memory is handled by explicit middleware above.
    // Otherwise, fall back to the shortcut parameter (no addCacheControl).
    memory: backend ? undefined : (memoryPaths.length > 0 ? memoryPaths : undefined),
    subagents: discoveredSubAgents.length > 0 ? discoveredSubAgents : undefined,
    permissions,
    interruptOn,
    checkpointer: true,  // Enables LangGraph checkpointing for HITL + session persistence.
                          // Note: DeepAgentsServer overrides this with its own MemorySaver in ACP mode.
    middleware,
  };
}
