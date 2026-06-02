/**
 * Agent Factory
 *
 * Creates a fully-configured deep agent with platform integration.
 * Uses shared helpers from runtime/helpers.ts for configuration building.
 *
 * This is the standalone factory — call it when you need an agent
 * without the ACP server (e.g., testing, programmatic use).
 * The ACP server in acp-server.ts uses the same helpers to build
 * its DeepAgentConfig for DeepAgentsServer.
 */

import { createDeepAgent, FilesystemBackend } from "deepagents";
import type { AppConfig, ACPSessionConfig } from "./config-loader.js";
import { logger } from "./logger.js";
import {
  createRuntimeContext,
  createRuntimeContextAsync,
  buildAgentConfigParts,
  resolveModelString,
  type RuntimeContext,
} from "./helpers.js";

// ─── Types ──────────────────────────────────────────────

export interface CreatedAgent {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agent: any;
  context: RuntimeContext;
  backend: FilesystemBackend;
}

// ─── Agent Factory ──────────────────────────────────────

/**
 * Create a fully-configured deep agent with platform integration.
 *
 * Steps:
 * 1. Create runtime context (PlatformClient, MCPManager, VariableManager, tools)
 * 2. Set up FilesystemBackend rooted at the workspace
 * 3. Call deepagents' createDeepAgent() with all composed params
 * 4. Return the agent + context + backend
 */
export function createAppAgent(
  config: AppConfig,
  sessionConfig?: ACPSessionConfig
): CreatedAgent {
  const log = logger.child("agent-factory");
  const workspaceRoot = sessionConfig?.cwd || process.cwd();

  log.info("Creating deep agent", {
    name: config.agent.name,
    model: resolveModelString(config),
    workspaceRoot,
  });

  // 1. Runtime context (PlatformClient, MCPManager, VariableManager, tools)
  const context = createRuntimeContext(config, sessionConfig);
  log.info("Custom tools ready", {
    count: context.tools.length,
    names: context.tools.map((t) => t.name),
  });

  // 2. FilesystemBackend
  const backend = new FilesystemBackend({ rootDir: workspaceRoot });

  // 3. Build agent config using shared helper
  const agentConfig = buildAgentConfigParts(config, sessionConfig, workspaceRoot, context.tools);

  // 4. Create the deep agent
  const agent = createDeepAgent({
    ...agentConfig,
    backend,
  });
  log.info("Deep agent created successfully");

  return { agent, context, backend };
}

/**
 * Async startup variant used by real CLI/ACP entrypoints.
 * It hydrates platform-delivered MCP servers before the agent is created.
 */
export async function createAppAgentAsync(
  config: AppConfig,
  sessionConfig?: ACPSessionConfig
): Promise<CreatedAgent> {
  const log = logger.child("agent-factory");
  const workspaceRoot = sessionConfig?.cwd || process.cwd();

  log.info("Creating deep agent", {
    name: config.agent.name,
    model: resolveModelString(config),
    workspaceRoot,
  });

  const context = await createRuntimeContextAsync(config, sessionConfig);
  log.info("Custom tools ready", {
    count: context.tools.length,
    names: context.tools.map((t) => t.name),
  });

  const backend = new FilesystemBackend({ rootDir: workspaceRoot });
  const agentConfig = buildAgentConfigParts(config, sessionConfig, workspaceRoot, context.tools);
  const agent = createDeepAgent({
    ...agentConfig,
    backend,
  });

  log.info("Deep agent created successfully");
  return { agent, context, backend };
}
