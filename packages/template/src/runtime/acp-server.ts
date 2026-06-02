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
import { loadConfig, type ACPSessionConfig } from "./config-loader.js";
import { logger } from "./logger.js";
import {
  createRuntimeContext,
  createRuntimeContextAsync,
  buildAgentConfigParts,
} from "./helpers.js";

/**
 * Patch a DeepAgentsServer instance to auto-recover from stale sessions.
 * When Zed sends a prompt/loadSession for a session that no longer exists
 * (e.g. after server restart), automatically create a new session instead
 * of throwing "Session not found".
 */
function patchSessionRecovery(server: DeepAgentsServer): void {
  const log = logger.child("session-recovery");
  const s = server as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

  const origLoadSession = s.handleLoadSession?.bind(server);
  const origPrompt = s.handlePrompt?.bind(server);

  if (origLoadSession) {
    s.handleLoadSession = async (...args: unknown[]) => {
      try {
        return await origLoadSession(...args);
      } catch (err) {
        if (err instanceof Error && err.message.includes("Session not found")) {
          const conn = args[1];
          const newSession = await s.handleNewSession?.({ mode: "agent" }, conn) as { sessionId: string } | undefined;
          if (newSession) {
            log.info("Auto-created session for stale loadSession", { created: newSession.sessionId });
            return newSession;
          }
        }
        throw err;
      }
    };
  }

  if (origPrompt) {
    s.handlePrompt = async (...args: unknown[]) => {
      try {
        return await origPrompt(...args);
      } catch (err) {
        if (err instanceof Error && err.message.includes("Session not found")) {
          const params = args[0] as { sessionId: string; prompt: unknown[] };
          const conn = args[1];
          const newSession = await s.handleNewSession?.({ mode: "agent" }, conn) as { sessionId: string } | undefined;
          if (newSession) {
            log.info("Auto-created session for stale prompt", {
              requested: params.sessionId,
              created: newSession.sessionId,
            });
            return await origPrompt({ ...params, sessionId: newSession.sessionId }, conn);
          }
        }
        throw err;
      }
    };
  }

  log.info("Session recovery patch applied");
}

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
  /** ACP/platform session config supplied by nuwaclaw at launch time */
  sessionConfig?: ACPSessionConfig;
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

  // Diagnostic: log effective model env vars (mask API key)
  log.info("Effective env vars", {
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "(unset)",
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? "(unset)",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "***" : "(unset)",
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ? "***" : "(unset)",
  });

  const sessionConfig = options.sessionConfig ?? loadSessionConfigFromEnv();

  // Validate that at least one model credential is available
  if (
    !process.env.ANTHROPIC_API_KEY &&
    !process.env.ANTHROPIC_AUTH_TOKEN &&
    !process.env.OPENAI_API_KEY &&
    !sessionConfig?.model
  ) {
    log.warn("No model credentials found. Set at least one of: ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, OPENAI_API_KEY");
  }

  // Load configuration
  const config = loadConfig({
    configPath: options.configPath,
    sessionConfig,
  });

  if (options.acp === false) {
    log.info("ACP mode disabled — skipping server start");
    return;
  }

  // Build DeepAgentConfig using shared helpers
  const agentConfig = await buildACPAgentConfigAsync(config, workspaceRoot, sessionConfig);

  // Start the ACP server with session recovery patch
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

  patchSessionRecovery(server);
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
export function buildACPAgentConfig(
  config: ReturnType<typeof loadConfig>,
  workspaceRoot: string,
  sessionConfig?: ACPSessionConfig
): DeepAgentConfig {
  const log = logger.child("config-builder");

  // Create runtime context (PlatformClient, MCPManager, VariableManager, tools)
  const runtimeCtx = createRuntimeContext(config, sessionConfig);

  const agentConfig: DeepAgentConfig = {
    // ACP-specific fields
    name: config.agent.name,
    description: config.agent.description,

    // CreateDeepAgentParams fields (via shared helper)
    ...buildAgentConfigParts(config, sessionConfig, workspaceRoot, runtimeCtx.tools),
    backend: new FilesystemBackend({ rootDir: workspaceRoot }),
  };

  log.info("Agent config built", {
    tools: runtimeCtx.tools.length,
    skills: agentConfig.skills,
    permissions: agentConfig.permissions?.length,
  });

  return agentConfig;
}

export async function buildACPAgentConfigAsync(
  config: ReturnType<typeof loadConfig>,
  workspaceRoot: string,
  sessionConfig?: ACPSessionConfig
): Promise<DeepAgentConfig> {
  const log = logger.child("config-builder");

  const runtimeCtx = await createRuntimeContextAsync(config, sessionConfig);
  const agentConfig: DeepAgentConfig = {
    name: config.agent.name,
    description: config.agent.description,
    ...buildAgentConfigParts(config, sessionConfig, workspaceRoot, runtimeCtx.tools),
    backend: new FilesystemBackend({ rootDir: workspaceRoot }),
  };

  log.info("Agent config built", {
    tools: runtimeCtx.tools.length,
    skills: agentConfig.skills,
    permissions: agentConfig.permissions?.length,
    mcpServers: runtimeCtx.mcpManager.listServers(),
  });

  return agentConfig;
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
