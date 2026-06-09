/**
 * ACP Agent Config Builder
 *
 * Builds the `DeepAgentConfig` passed to `DeepAgentsServer` (which calls
 * `createDeepAgent()` internally). Uses the same `buildAgentConfigParts` helper
 * as the standalone agent factory, so an agent is configured identically whether
 * started standalone or over ACP.
 *
 * Three public variants share one assembler:
 *   - buildACPAgentConfig          — sync runtime context
 *   - buildACPAgentConfigAsync     — async runtime context (hydrates platform MCP)
 *   - buildACPAgentConfigWithMcpAsync — async + returns the MCPManager for ACP
 *     session mcpServers forwarding
 */

import { type DeepAgentConfig } from "deepagents-acp";
import { type AppConfig, type ACPSessionConfig } from "../../runtime/config/config-loader.js";
import { logger } from "../../runtime/logger.js";
import type { MCPManager } from "../../runtime/platform/mcp-manager.js";
import {
  createRuntimeContext,
  createRuntimeContextAsync,
  buildAgentConfigParts,
  type RuntimeContext,
} from "../../runtime/helpers.js";
import { getAcpSlashCommandSpecs } from "../../runtime/slash-commands.js";

// loadConfig() returns AppConfig; alias kept for readable builder signatures.
type LoadedConfig = AppConfig;

/**
 * Assemble the ACP DeepAgentConfig from an already-created runtime context.
 *
 * - `interruptOn` is forced empty: deepagents-acp does not handle LangGraph
 *   interrupts from humanInTheLoopMiddleware, which would hang tool calls.
 *   Path-based permissions still apply.
 * - No `backend` is set: DeepAgentsServer creates an ACPFilesystemBackend
 *   (enabling IDE integration such as unsaved-buffer reads) when none is given.
 */
function assembleAcpAgentConfig(
  config: LoadedConfig,
  workspaceRoot: string,
  sessionConfig: ACPSessionConfig | undefined,
  runtimeCtx: RuntimeContext
): DeepAgentConfig {
  const agentConfig = {
    name: config.agent.name,
    description: config.agent.description,
    commands: getAcpSlashCommandSpecs(),
    ...buildAgentConfigParts(config, sessionConfig, workspaceRoot, runtimeCtx.tools),
    interruptOn: {},
  } as unknown as DeepAgentConfig;

  logger.child("config-builder").info("Agent config built", {
    tools: runtimeCtx.tools.length,
    skills: agentConfig.skills,
    permissions: agentConfig.permissions?.length,
    mcpServers: runtimeCtx.mcpManager.listServers(),
  });

  return agentConfig;
}

/**
 * Build a DeepAgentConfig for the ACP server (synchronous runtime context).
 */
export function buildACPAgentConfig(
  config: LoadedConfig,
  workspaceRoot: string,
  sessionConfig?: ACPSessionConfig
): DeepAgentConfig {
  const runtimeCtx = createRuntimeContext(config, sessionConfig, workspaceRoot);
  return assembleAcpAgentConfig(config, workspaceRoot, sessionConfig, runtimeCtx);
}

/**
 * Build a DeepAgentConfig with an async runtime context (platform MCP hydrated).
 */
export async function buildACPAgentConfigAsync(
  config: LoadedConfig,
  workspaceRoot: string,
  sessionConfig?: ACPSessionConfig
): Promise<DeepAgentConfig> {
  const runtimeCtx = await createRuntimeContextAsync(config, sessionConfig, workspaceRoot);
  return assembleAcpAgentConfig(config, workspaceRoot, sessionConfig, runtimeCtx);
}

/**
 * Build agent config + expose MCPManager for ACP session MCP forwarding.
 */
export async function buildACPAgentConfigWithMcpAsync(
  config: LoadedConfig,
  workspaceRoot: string,
  sessionConfig?: ACPSessionConfig
): Promise<{ agentConfig: DeepAgentConfig; mcpManager: MCPManager }> {
  const runtimeCtx = await createRuntimeContextAsync(config, sessionConfig, workspaceRoot);
  const agentConfig = assembleAcpAgentConfig(config, workspaceRoot, sessionConfig, runtimeCtx);
  return { agentConfig, mcpManager: runtimeCtx.mcpManager };
}

export function loadSessionConfigFromEnv(): ACPSessionConfig | undefined {
  const raw = process.env.ACP_SESSION_CONFIG_JSON;
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as ACPSessionConfig;
  } catch (err) {
    logger.warn("Failed to parse ACP_SESSION_CONFIG_JSON", {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}
