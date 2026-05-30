/**
 * ACP Server
 *
 * Bootstraps the deepagents-acp DeepAgentsServer with platform integration.
 *
 * The DeepAgentsServer class from deepagents-acp:
 * - Manages ACP sessions (new, prompt, cancel, set_mode)
 * - Streams tool calls and text deltas to ACP clients
 * - Creates DeepAgent instances per session via createDeepAgent()
 * - Handles workspace file operations via ACPFilesystemBackend
 *
 * This module builds the DeepAgentConfig using shared helpers from
 * runtime/helpers.ts (same ones used by agent-factory.ts), then passes
 * the config to DeepAgentsServer which handles the rest.
 */

import { DeepAgentsServer, type DeepAgentConfig } from "deepagents-acp";
import { FilesystemBackend } from "deepagents";
import { loadConfig } from "./config-loader.js";
import { logger } from "./logger.js";
import {
  createRuntimeContext,
  buildAgentConfigParts,
} from "./helpers.js";

// ─── Types ──────────────────────────────────────────────

export interface ACPServerOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Path to config file */
  configPath?: string;
  /** Run in ACP mode (default: true) */
  acp?: boolean;
  /** Workspace root override */
  workspaceRoot?: string;
}

// ─── Bootstrap ──────────────────────────────────────────

/**
 * Bootstrap the agent runtime and start the ACP server.
 * Main entry point called from src/index.ts.
 */
export async function bootstrap(options: ACPServerOptions = {}): Promise<void> {
  const log = logger.child("bootstrap");

  if (options.debug) {
    process.env.LOG_LEVEL = "debug";
  }

  const workspaceRoot = options.workspaceRoot || process.cwd();

  log.info("Bootstrapping DeepAgents app agent", {
    acp: options.acp,
    debug: options.debug,
    workspaceRoot,
  });

  // Load configuration
  const config = loadConfig({ configPath: options.configPath });

  if (options.acp === false) {
    log.info("ACP mode disabled — skipping server start");
    return;
  }

  // Build DeepAgentConfig using shared helpers
  const agentConfig = buildAgentConfig(config, workspaceRoot);

  // Start the ACP server
  const server = new DeepAgentsServer({
    agents: agentConfig,
    serverName: config.agent.name,
    serverVersion: config.agent.version,
    workspaceRoot,
    debug: process.env.LOG_LEVEL === "debug",
  });

  log.info("Starting DeepAgentsServer", {
    name: agentConfig.name,
    model: agentConfig.model,
    skills: agentConfig.skills,
    tools: agentConfig.tools?.length,
  });

  await server.start();
}

// ─── Build Agent Config ─────────────────────────────────

/**
 * Build a DeepAgentConfig for the ACP server using shared helpers.
 *
 * DeepAgentsServer will call createDeepAgent() internally with these params.
 * This function uses the exact same helpers as agent-factory.ts, ensuring
 * consistent configuration whether the agent is started standalone or via ACP.
 */
function buildAgentConfig(
  config: ReturnType<typeof loadConfig>,
  workspaceRoot: string
): DeepAgentConfig {
  const log = logger.child("config-builder");

  // Create runtime context (PlatformClient, MCPManager, VariableManager, tools)
  const runtimeCtx = createRuntimeContext(config);

  const agentConfig: DeepAgentConfig = {
    // ACP-specific fields
    name: config.agent.name,
    description: config.agent.description,

    // CreateDeepAgentParams fields (via shared helper)
    ...buildAgentConfigParts(config, undefined, workspaceRoot, runtimeCtx.tools),
    backend: new FilesystemBackend({ rootDir: workspaceRoot }),
  };

  log.info("Agent config built", {
    tools: runtimeCtx.tools.length,
    skills: agentConfig.skills,
    permissions: agentConfig.permissions?.length,
  });

  return agentConfig;
}
