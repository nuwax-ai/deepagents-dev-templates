/**
 * Runtime Context
 *
 * The set of runtime components that tools and the agent depend on:
 * PlatformClient (optional), MCPManager, VariableManager, the ToolContext that
 * binds them to tools, and the tools array. Created once per agent lifecycle
 * (bootstrap or standalone factory call).
 */

import type { StructuredTool } from "@langchain/core/tools";
import { resolveConfiguredWorkspaceRoot, type AppConfig, type ACPSessionConfig } from "./config/config-loader.js";
import { PlatformClient } from "./platform/platform-client.js";
import { MCPManager } from "./platform/mcp-manager.js";
import { VariableManager } from "./platform/variable-manager.js";
import { createTools, type ToolContext } from "../app/tools/index.js";
import { logger } from "./logger.js";
import { loadMcpTools } from "./platform/mcp-tool-loader.js";

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
  /** Builtin tools created from the tool registry */
  tools: StructuredTool[];
  /** MCP tools loaded from configured MCP servers (native LangChain tools) */
  mcpTools: StructuredTool[];
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
  sessionConfig?: ACPSessionConfig,
  workspaceRoot?: string
): RuntimeContext {
  const log = logger.child("runtime-context");
  const resolvedWorkspaceRoot = resolveConfiguredWorkspaceRoot(
    config,
    workspaceRoot ?? sessionConfig?.cwd ?? process.cwd()
  );

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

  const defaultMcpDisabled = process.env.DEEPAGENTS_DEFAULT_MCP === "disabled";
  const mcpManager = new MCPManager({
    defaultConfig: {
      servers: config.mcp.servers as Record<string, { command?: string; args?: string[]; url?: string }>,
    },
    defaultConfigPath: defaultMcpDisabled ? undefined : config.mcp.configPath,
    defaultConfigPaths: defaultMcpDisabled ? [] : config.mcp.configPaths,
    mergeStrategy: config.mcp.mergeStrategy,
    baseDir: resolvedWorkspaceRoot,
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
    workspaceRoot: resolvedWorkspaceRoot,
    config,
  };

  // Create tools bound to the runtime context
  const tools = createTools(toolContext);

  log.info("Runtime context created", {
    mode: hasPlatform ? "platform" : "local",
    agentId: agentId || "(none)",
    mcpServers: mcpManager.listServers(),
    tools: tools.length,
  });

  return { config, platformClient, mcpManager, variableManager, toolContext, tools, mcpTools: [] };
}

/**
 * Hydrate async runtime layers: platform MCP config + MCP native tool loading.
 *
 * The custom MCP bridge holds a reference to the MCPManager, so it is safe to
 * populate platform MCP config after tool objects are created and before the
 * agent starts processing prompts.
 */
export async function hydrateRuntimeContext(context: RuntimeContext): Promise<RuntimeContext> {
  const log = logger.child("runtime-context");

  // Hydrate platform MCP config if platform client is available
  if (context.platformClient) {
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
  }

  // Load MCP native tools from all configured servers
  try {
    context.mcpTools = await loadMcpTools(context.mcpManager);
  } catch (err) {
    log.warn("Failed to load MCP tools; continuing with builtin tools only", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Wire MCP-aware executor for schedule_action so scheduled timers can dispatch
  // MCP tools (e.g. chrome-devtools.close_page) in addition to builtin tools.
  if (context.mcpTools.length > 0) {
    const allTools = [...context.tools, ...context.mcpTools];

    context.toolContext.toolExecutor = async (toolName, args) => {
      const target = allTools.find(t => t.name === toolName);
      if (target) return String(await target.invoke(args));
      return `Error: tool "${toolName}" not found for scheduled execution`;
    };

    // Extend the schedulable-tools set so schedule_action accepts MCP tool names.
    for (const t of context.mcpTools) {
      context.toolContext.schedulableTools?.add(t.name);
    }
  }

  return context;
}

export async function createRuntimeContextAsync(
  config: AppConfig,
  sessionConfig?: ACPSessionConfig,
  workspaceRoot?: string
): Promise<RuntimeContext> {
  return await hydrateRuntimeContext(createRuntimeContext(config, sessionConfig, workspaceRoot));
}
