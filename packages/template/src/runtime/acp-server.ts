/**
 * ACP Server
 *
 * Bootstraps the deepagents-acp DeepAgentsServer with platform integration.
 *
 * The DeepAgentsServer class from deepagents-acp:
 * - Manages ACP sessions (new, prompt, cancel, set_mode)
 * - Streams tool calls and text deltas to ACP clients
 * - Creates DeepAgent instances per session via createDeepAgent()
 * - Handles HITL permission requests via requestToolPermission()
 * - Handles workspace file operations via ACPFilesystemBackend
 *
 * This module builds the DeepAgentConfig using shared helpers from
 * runtime/helpers.ts (same ones used by agent-factory.ts), then passes
 * the config to DeepAgentsServer which handles the rest.
 */

import { DeepAgentsServer, type DeepAgentConfig } from "deepagents-acp";
import { randomUUID } from "node:crypto";
import { loadConfig, resolveConfiguredWorkspaceRoot, type ACPSessionConfig } from "./config-loader.js";
import { logger } from "./logger.js";
import type { MCPManager } from "./mcp-manager.js";
import { forwardAcpMcpServers } from "./mcp-acp-adapter.js";
import {
  createRuntimeContext,
  createRuntimeContextAsync,
  buildAgentConfigParts,
} from "./helpers.js";
import {
  executeSlashCommand,
  getAcpSlashCommandSpecs,
  type SlashToolInfo,
} from "./slash-commands.js";
import {
  appendRuntimeMessage,
  ensureSessionState,
  getRuntimeStorage,
  withRuntimeStorageContext,
} from "./runtime-storage.js";

// ─── Session Lifecycle Manager ──────────────────────────

interface SessionInfo {
  sessionId: string;
  createdAt: string;
  lastActivityAt: string;
  mode: string;
  messageCount: number;
}

interface AcpPromptBlock {
  type?: string;
  text?: string;
}

interface AcpPromptParams {
  sessionId: string;
  prompt: AcpPromptBlock[];
}

interface AcpNewSessionParams {
  sessionId?: string;
  mode?: string;
  cwd?: string;
  mcpServers?: unknown;
  configOptions?: { agent?: string } | null;
}

interface AcpConnection {
  sessionUpdate(params: {
    sessionId: string;
    update: {
      sessionUpdate: "agent_message_chunk";
      content: {
        type: "text";
        text: string;
      };
    };
  }): Promise<void>;
}

interface AcpSessionState {
  id: string;
  agentName: string;
  mode?: string;
}

interface DeepAgentsServerInternals {
  handleNewSession?: (...args: unknown[]) => Promise<unknown>;
  handleLoadSession?: (...args: unknown[]) => Promise<unknown>;
  handlePrompt?: (...args: unknown[]) => Promise<unknown>;
  handleCancel?: (...args: unknown[]) => Promise<unknown>;
  handleSetSessionMode?: (...args: unknown[]) => Promise<unknown>;
  handleCloseSession?: (...args: unknown[]) => Promise<unknown>;
  handleListSessions?: (...args: unknown[]) => Promise<unknown>;
  sessions?: Map<string, AcpSessionState & Record<string, unknown>>;
  agentConfigs?: Map<string, DeepAgentConfig>;
  agents?: Map<string, unknown>;
  acpBackends?: Map<string, { setSessionId?: (sessionId: string) => void }>;
  workspaceRoot?: string;
  createAgent?: (agentName: string) => void;
}

/**
 * Session lifecycle manager. Tracks active sessions and provides
 * close/list operations that deepagents-acp doesn't natively support.
 */
class SessionManager {
  private sessions = new Map<string, SessionInfo>();
  private log = logger.child("session-manager");

  track(sessionId: string, mode: string): void {
    this.sessions.set(sessionId, {
      sessionId,
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      mode,
      messageCount: 0,
    });
    this.log.debug("Session tracked", { sessionId, mode, total: this.sessions.size });
  }

  touch(sessionId: string): void {
    const info = this.sessions.get(sessionId);
    if (info) {
      info.lastActivityAt = new Date().toISOString();
      info.messageCount++;
    }
  }

  close(sessionId: string): SessionInfo | undefined {
    const info = this.sessions.get(sessionId);
    if (info) {
      this.sessions.delete(sessionId);
      this.log.info("Session closed", { sessionId, messages: info.messageCount });
    }
    return info;
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  get count(): number {
    return this.sessions.size;
  }
}

// ─── ACP MCP Forwarding Toggle ──────────────────────────

/**
 * When deepagents-acp adds native MCP forwarding, set this env var to
 * disable our custom forwarding and avoid double-loading:
 *
 *   ACP_MCP_FORWARDING=disabled
 *
 * Or remove the forwardAcpMcpServers() call from patchSessionLifecycle
 * and delete mcp-acp-adapter.ts entirely.
 */
function isAcpMcpForwardingEnabled(): boolean {
  return process.env.ACP_MCP_FORWARDING !== "disabled";
}

// ─── Session Lifecycle Patch ────────────────────────────

/**
 * Patch a DeepAgentsServer instance to:
 * 1. Track session lifecycle (new, close, list)
 * 2. Forward ACP session mcpServers to MCPManager (when enabled)
 * 3. Add closeSession and listSessions methods
 *
 * HITL permission handling is done natively by DeepAgentsServer
 * via requestToolPermission() — no patching needed.
 *
 * @rollback — To remove ACP MCP forwarding when deepagents-acp adds native support:
 *   1. Delete mcp-acp-adapter.ts
 *   2. Remove the forwardAcpMcpServers() call below
 *   3. Remove the mcpManager parameter from this function
 *   4. Update bootstrap() to call patchSessionLifecycle(server) without mcpManager
 */
function patchSessionLifecycle(
  server: DeepAgentsServer,
  mcpManager: MCPManager,
  config: ReturnType<typeof loadConfig>,
  workspaceRoot: string,
  options: {
    configPath?: string;
    sessionConfig?: ACPSessionConfig;
    useSessionCwd: boolean;
  }
): SessionManager {
  const log = logger.child("session-lifecycle");
  const manager = new SessionManager();
  const s = server as unknown as DeepAgentsServerInternals;
  const mcpForwardingEnabled = isAcpMcpForwardingEnabled();
  let activeConfig = config;
  let activeMcpManager = mcpManager;
  let activeWorkspaceRoot = workspaceRoot;

  if (!mcpForwardingEnabled) {
    log.info("ACP MCP forwarding disabled via ACP_MCP_FORWARDING=disabled");
  }

  // Track last-known mcpServers per session for recovery
  const sessionMcpServers = new Map<string, unknown>();
  const sessionWorkspaces = new Map<string, { config: ReturnType<typeof loadConfig>; workspaceRoot: string }>();

  const prepareSessionWorkspace = async (params: AcpNewSessionParams): Promise<void> => {
    if (!options.useSessionCwd || !params.cwd) {
      return;
    }

    const requestedConfig = loadConfig({
      configPath: options.configPath,
      sessionConfig: { ...options.sessionConfig, cwd: params.cwd },
      workspaceRoot: params.cwd,
    });
    const requestedWorkspaceRoot = resolveConfiguredWorkspaceRoot(requestedConfig, params.cwd);
    if (requestedWorkspaceRoot === activeWorkspaceRoot) {
      return;
    }

    const { agentConfig, mcpManager: sessionMcpManager } = await buildACPAgentConfigWithMcpAsync(
      requestedConfig,
      requestedWorkspaceRoot,
      { ...options.sessionConfig, cwd: requestedWorkspaceRoot }
    );

    activeConfig = requestedConfig;
    activeMcpManager = sessionMcpManager;
    activeWorkspaceRoot = requestedWorkspaceRoot;
    s.workspaceRoot = requestedWorkspaceRoot;
    s.agentConfigs?.set(agentConfig.name, agentConfig);
    s.agents?.delete(agentConfig.name);
    s.acpBackends?.delete(agentConfig.name);

    log.info("Using ACP session cwd as workspace root", {
      workspaceRoot: requestedWorkspaceRoot,
    });
  };

  const ensureClientSession = (params: AcpNewSessionParams): void => {
    if (!params.sessionId || s.sessions?.has(params.sessionId)) {
      return;
    }

    const agentName =
      params.configOptions?.agent ??
      Array.from(s.agentConfigs?.keys() ?? [])[0];
    if (!agentName || !s.agentConfigs?.has(agentName)) {
      throw new Error(`Unknown agent: ${agentName ?? "(none)"}`);
    }

    s.sessions?.set(params.sessionId, {
      id: params.sessionId,
      agentName,
      threadId: randomUUID(),
      messages: [],
      createdAt: new Date(),
      lastActivityAt: new Date(),
      mode: params.mode ?? "agent",
    });
    if (!s.agents?.has(agentName)) {
      s.createAgent?.(agentName);
    }
    s.acpBackends?.get(agentName)?.setSessionId?.(params.sessionId);
    manager.track(params.sessionId, params.mode ?? "agent");
    sessionWorkspaces.set(params.sessionId, {
      config: activeConfig,
      workspaceRoot: activeWorkspaceRoot,
    });
    ensureSessionState(
      getRuntimeStorage({ workspaceRoot: activeWorkspaceRoot, sessionId: params.sessionId }),
      { mode: params.mode ?? "agent", agent: activeConfig.agent.name, environment: "acp", recovered: true }
    );
    if (mcpForwardingEnabled && params.mcpServers) {
      sessionMcpServers.set(params.sessionId, params.mcpServers);
      forwardAcpMcpServers(params.mcpServers, activeMcpManager);
    }
    log.info("Recovered missing ACP client session", {
      sessionId: params.sessionId,
      workspaceRoot: activeWorkspaceRoot,
    });
  };

  // Patch handleNewSession to track sessions + forward MCP servers.
  // We do NOT resend available_commands_update after session creation:
  // deepagents-acp's handleNewSession already sends it synchronously inside
  // the original handler (node_modules/deepagents-acp/dist/index.cjs:785) with
  // [...DEFAULT_COMMANDS, ...customCommands], where customCommands comes from
  // agentConfig.commands (set to getAcpSlashCommandSpecs() in buildACPAgentConfig).
  // A second send would race with the first and produce inconsistent UI.
  const origNewSession = s.handleNewSession?.bind(server);
  if (origNewSession) {
    s.handleNewSession = async (...args: unknown[]) => {
      const params = args[0] as AcpNewSessionParams;
      await prepareSessionWorkspace(params);
      const result = await origNewSession(...args) as { sessionId: string } | undefined;
      if (result?.sessionId) {
        manager.track(result.sessionId, params?.mode ?? "agent");
        sessionWorkspaces.set(result.sessionId, {
          config: activeConfig,
          workspaceRoot: activeWorkspaceRoot,
        });
        ensureSessionState(
          getRuntimeStorage({ workspaceRoot: activeWorkspaceRoot, sessionId: result.sessionId }),
          { mode: params?.mode ?? "agent", agent: activeConfig.agent.name, environment: "acp" }
        );
        // @rollback: remove this block when deepagents-acp supports MCP natively
        if (mcpForwardingEnabled && params.mcpServers) {
          sessionMcpServers.set(result.sessionId, params.mcpServers);
          forwardAcpMcpServers(params.mcpServers, activeMcpManager);
        }
      }
      return result;
    };
  }

  const origLoadSession = s.handleLoadSession?.bind(server);
  if (origLoadSession) {
    s.handleLoadSession = async (...args: unknown[]) => {
      const params = args[0] as AcpNewSessionParams;
      await prepareSessionWorkspace(params);
      ensureClientSession(params);
      return await origLoadSession(...args);
    };
  }

  // Patch handlePrompt for activity tracking + stale session recovery
  const origPrompt = s.handlePrompt?.bind(server);
  if (origPrompt) {
    s.handlePrompt = async (...args: unknown[]) => {
      const params = args[0] as AcpPromptParams;
      const conn = args[1] as AcpConnection | undefined;
      ensureClientSession({ sessionId: params.sessionId });
      const promptText = getAcpPromptText(params.prompt);
      const sessionWorkspace = sessionWorkspaces.get(params.sessionId) ?? {
        config: activeConfig,
        workspaceRoot: activeWorkspaceRoot,
      };
      const storage = getRuntimeStorage({ workspaceRoot: sessionWorkspace.workspaceRoot, sessionId: params.sessionId });
      if (promptText) {
        appendRuntimeMessage({ role: "user", content: promptText }, storage);
      }

      const slashResult = await withRuntimeStorageContext({ workspaceRoot: sessionWorkspace.workspaceRoot, sessionId: params.sessionId }, () =>
        handleAcpSlashCommand({
          server: s,
          params,
          conn,
          config: sessionWorkspace.config,
          workspaceRoot: sessionWorkspace.workspaceRoot,
        })
      );

      if (slashResult) {
        manager.touch(params.sessionId);
        return slashResult;
      }

      try {
        const result = await withRuntimeStorageContext(
          { workspaceRoot: sessionWorkspace.workspaceRoot, sessionId: params.sessionId },
          () => origPrompt(...args)
        );
        // Only count successful prompts
        manager.touch(params.sessionId);
        return result;
      } catch (err) {
        if (err instanceof Error && err.message.includes("Session not found")) {
          // Clean up the dead session
          manager.close(params.sessionId);
          const savedMcp = sessionMcpServers.get(params.sessionId);
          sessionMcpServers.delete(params.sessionId);
          sessionWorkspaces.delete(params.sessionId);

          const conn = args[1];
          const newSession = await s.handleNewSession?.(
            { mode: "agent", mcpServers: savedMcp, cwd: sessionWorkspace.workspaceRoot },
            conn
          ) as { sessionId: string } | undefined;
          if (newSession) {
            log.info("Auto-created session for stale prompt", {
              requested: params.sessionId,
              created: newSession.sessionId,
            });
            // Use the patched handlePrompt (not origPrompt) for activity tracking
            return await (s.handlePrompt as Function)(
              { ...params, sessionId: newSession.sessionId },
              conn
            );
          }
        }
        throw err;
      }
    };
  }

  // Patch handleCancel for activity tracking
  const origCancel = s.handleCancel?.bind(server);
  if (origCancel) {
    s.handleCancel = async (...args: unknown[]) => {
      const params = args[0] as { sessionId?: string };
      if (params?.sessionId) manager.touch(params.sessionId);
      return origCancel(...args);
    };
  }

  const origSetSessionMode = s.handleSetSessionMode?.bind(server);
  if (origSetSessionMode) {
    s.handleSetSessionMode = async (...args: unknown[]) => {
      const params = args[0] as AcpNewSessionParams;
      await prepareSessionWorkspace(params);
      ensureClientSession(params);
      return await origSetSessionMode(...args);
    };
  }

  // Add closeSession method
  s.handleCloseSession = async (...args: unknown[]) => {
    const params = args[0] as { sessionId: string };
    const info = manager.close(params.sessionId);
    sessionMcpServers.delete(params.sessionId);
    sessionWorkspaces.delete(params.sessionId);
    if (!info) {
      return { error: `Session not found: ${params.sessionId}` };
    }
    return { closed: true, sessionId: params.sessionId, messages: info.messageCount };
  };

  // Add listSessions method
  s.handleListSessions = async (..._args: unknown[]) => {
    return { sessions: manager.list(), total: manager.count };
  };

  log.info("Session lifecycle patch applied", {
    features: ["tracking", "close", "list", "slash-commands"],
  });

  return manager;
}

async function handleAcpSlashCommand(options: {
  server: DeepAgentsServerInternals;
  params: AcpPromptParams;
  conn?: AcpConnection;
  config: ReturnType<typeof loadConfig>;
  workspaceRoot: string;
}): Promise<{ stopReason: "end_turn" } | null> {
  const text = getAcpPromptText(options.params.prompt);
  if (!text?.startsWith("/")) {
    return null;
  }

  const session = options.server.sessions?.get(options.params.sessionId);
  const agentConfig = session
    ? options.server.agentConfigs?.get(session.agentName)
    : undefined;

  const result = executeSlashCommand(text, {
    environment: "acp",
    tools: toSlashToolInfo(agentConfig?.tools),
    config: options.config,
    workspaceRoot: options.workspaceRoot,
    mode: session?.mode,
    sessionId: session?.id,
  });

  if (!result) {
    return null;
  }

  if (result.text && options.conn) {
    await sendAcpText(options.params.sessionId, options.conn, result.text);
    appendRuntimeMessage(
      { role: "assistant", content: result.text },
      getRuntimeStorage({ workspaceRoot: options.workspaceRoot, sessionId: options.params.sessionId })
    );
  }

  return { stopReason: "end_turn" };
}

function getAcpPromptText(prompt: AcpPromptBlock[]): string | null {
  const block = prompt.find((candidate) => candidate.type === "text" && candidate.text);
  return block?.text?.trim() ?? null;
}

function toSlashToolInfo(tools: unknown): SlashToolInfo[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  const result: SlashToolInfo[] = [];
  for (const tool of tools) {
    const candidate = tool as { name?: unknown; description?: unknown };
    if (typeof candidate.name !== "string") {
      continue;
    }

    const info: SlashToolInfo = { name: candidate.name };
    if (typeof candidate.description === "string") {
      info.description = candidate.description;
    }
    result.push(info);
  }

  return result;
}

async function sendAcpText(
  sessionId: string,
  conn: AcpConnection,
  text: string
): Promise<void> {
  await conn.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text,
      },
    },
  });
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

  const sessionConfig = options.sessionConfig ?? loadSessionConfigFromEnv();
  const initialWorkspaceRoot = options.workspaceRoot || sessionConfig?.cwd || process.cwd();

  log.info("Bootstrapping DeepAgents app agent", {
    acp: options.acp,
    debug: options.debug,
    workspaceRoot: initialWorkspaceRoot,
  });

  // Diagnostic: log effective model env vars (mask API key)
  log.info("Effective env vars", {
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "(unset)",
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? "(unset)",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "***" : "(unset)",
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ? "***" : "(unset)",
  });

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
    workspaceRoot: initialWorkspaceRoot,
  });
  const workspaceRoot = resolveConfiguredWorkspaceRoot(config, initialWorkspaceRoot);

  if (options.acp === false) {
    log.info("ACP mode disabled — skipping server start");
    return;
  }

  // Build DeepAgentConfig using shared helpers
  const { agentConfig, mcpManager } = await buildACPAgentConfigWithMcpAsync(config, workspaceRoot, sessionConfig);

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

  // Pass mcpManager so ACP session mcpServers can be forwarded
  const _sessionManager = patchSessionLifecycle(server, mcpManager, config, workspaceRoot, {
    configPath: options.configPath,
    sessionConfig,
    useSessionCwd: !options.workspaceRoot && !config.workspace.workingDir,
  });
  log.info("Active sessions after startup", { count: _sessionManager.count });
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
  const runtimeCtx = createRuntimeContext(config, sessionConfig, workspaceRoot);

  const agentConfigParts = buildAgentConfigParts(config, sessionConfig, workspaceRoot, runtimeCtx.tools);

	  const agentConfig = {
    // ACP-specific fields
    name: config.agent.name,
    description: config.agent.description,
    commands: getAcpSlashCommandSpecs(),

    // CreateDeepAgentParams fields (via shared helper)
    ...agentConfigParts,
    // Disable HITL interruptOn in ACP mode — deepagents-acp does not handle
    // LangGraph interrupts from humanInTheLoopMiddleware, which causes tool
    // calls to hang indefinitely. Path-based permissions still work.
    interruptOn: {},
    // Do NOT set backend here — DeepAgentsServer creates ACPFilesystemBackend
    // when no backend is provided, enabling IDE integration (unsaved buffer reads).
	  } as unknown as DeepAgentConfig;

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

  const runtimeCtx = await createRuntimeContextAsync(config, sessionConfig, workspaceRoot);
	  const agentConfig = {
    name: config.agent.name,
    description: config.agent.description,
    commands: getAcpSlashCommandSpecs(),
    ...buildAgentConfigParts(config, sessionConfig, workspaceRoot, runtimeCtx.tools),
    // Do NOT set backend — DeepAgentsServer creates ACPFilesystemBackend automatically,
    // which provides IDE integration (unsaved buffer reads via ACP client).
	  } as unknown as DeepAgentConfig;

  log.info("Agent config built", {
    tools: runtimeCtx.tools.length,
    skills: agentConfig.skills,
    permissions: agentConfig.permissions?.length,
    mcpServers: runtimeCtx.mcpManager.listServers(),
  });

  return agentConfig;
}

/**
 * Build agent config + expose MCPManager for ACP session MCP forwarding.
 */
export async function buildACPAgentConfigWithMcpAsync(
  config: ReturnType<typeof loadConfig>,
  workspaceRoot: string,
  sessionConfig?: ACPSessionConfig
): Promise<{ agentConfig: DeepAgentConfig; mcpManager: MCPManager }> {
  const log = logger.child("config-builder");

  const runtimeCtx = await createRuntimeContextAsync(config, sessionConfig, workspaceRoot);
	  const agentConfig = {
    name: config.agent.name,
    description: config.agent.description,
    commands: getAcpSlashCommandSpecs(),
    ...buildAgentConfigParts(config, sessionConfig, workspaceRoot, runtimeCtx.tools),
	  } as unknown as DeepAgentConfig;

  log.info("Agent config built", {
    tools: runtimeCtx.tools.length,
    skills: agentConfig.skills,
    permissions: agentConfig.permissions?.length,
    mcpServers: runtimeCtx.mcpManager.listServers(),
  });

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
