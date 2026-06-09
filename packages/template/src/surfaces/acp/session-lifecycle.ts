/**
 * ACP Session Lifecycle
 *
 * Patches a `DeepAgentsServer` instance to add capabilities deepagents-acp does
 * not provide natively: session tracking (new/close/list), ACP session
 * mcpServers forwarding, durable session state, harness-turn lifecycle, stale
 * session recovery, and slash-command handling. All reach-through to the
 * server's private internals goes through `acp-server-internals.ts`.
 */

import { DeepAgentsServer } from "deepagents-acp";
import { randomUUID } from "node:crypto";
import { loadConfig, resolveConfiguredWorkspaceRoot, type ACPSessionConfig } from "../../runtime/config-loader.js";
import { logger } from "../../runtime/logger.js";
import type { MCPManager } from "../../runtime/mcp-manager.js";
import { forwardAcpMcpServers } from "../../runtime/mcp-acp-adapter.js";
import {
  bindInternalHandler,
  getDeepAgentsServerInternals,
  type DeepAgentsServerInternals,
} from "../../runtime/acp-server-internals.js";
import {
  beginHarnessTurn,
  completeHarnessTurn,
  failHarnessTurn,
  readHarnessLifecycle,
} from "../../runtime/harness-lifecycle.js";
import {
  executeSlashCommand,
  type SlashToolInfo,
} from "../../runtime/slash-commands.js";
import {
  appendRuntimeMessage,
  closeSessionState,
  ensureSessionState,
  getRuntimeStorage,
  loadSessionState,
  listSessions,
  withRuntimeStorageContext,
} from "../../runtime/runtime-storage.js";
import { buildACPAgentConfigWithMcpAsync } from "./config-builder.js";

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

/**
 * Session lifecycle manager. Tracks active sessions and provides
 * close/list operations that deepagents-acp doesn't natively support.
 */
export class SessionManager {
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
export function patchSessionLifecycle(
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
  const s = getDeepAgentsServerInternals(server, [
    "agent-configs",
    "sessions",
    "agents",
    "acp-backends",
  ]);
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
    agentConfig.interruptOn = {};
    s.agentConfigs.set(agentConfig.name, agentConfig);
    s.agents.delete(agentConfig.name);
    s.acpBackends.delete(agentConfig.name);

    log.info("Using ACP session cwd as workspace root", {
      workspaceRoot: requestedWorkspaceRoot,
    });
  };

  const ensureClientSession = (params: AcpNewSessionParams): void => {
    if (!params.sessionId || s.sessions.has(params.sessionId)) {
      return;
    }

    const agentName =
      params.configOptions?.agent ??
      Array.from(s.agentConfigs.keys())[0];
    if (!agentName || !s.agentConfigs.has(agentName)) {
      throw new Error(`Unknown agent: ${agentName ?? "(none)"}`);
    }

    s.sessions.set(params.sessionId, {
      id: params.sessionId,
      agentName,
      threadId: randomUUID(),
      messages: [],
      createdAt: new Date(),
      lastActivityAt: new Date(),
      mode: params.mode ?? "agent",
    });
    if (!s.agents.has(agentName)) {
      s.createAgent?.(agentName);
    }
    s.acpBackends.get(agentName)?.setSessionId?.(params.sessionId);
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
  const origNewSession = bindInternalHandler(server, s.handleNewSession);
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

  const origLoadSession = bindInternalHandler(server, s.handleLoadSession);
  if (origLoadSession) {
    s.handleLoadSession = async (...args: unknown[]) => {
      const params = args[0] as AcpNewSessionParams;
      await prepareSessionWorkspace(params);
      ensureClientSession(params);
      if (params.sessionId) {
        const loaded = loadSessionState(activeWorkspaceRoot, params.sessionId, { maxMessages: 20 });
        ensureSessionState(
          getRuntimeStorage({ workspaceRoot: activeWorkspaceRoot, sessionId: params.sessionId }),
          {
            mode: params.mode ?? loaded.summary.mode ?? "agent",
            agent: activeConfig.agent.name,
            environment: "acp",
            loadedAt: new Date().toISOString(),
            loadedMessageCount: loaded.summary.messageCount ?? 0,
            previousStatus: loaded.summary.status,
          }
        );
        log.info("Loaded durable session summary", {
          sessionId: params.sessionId,
          exists: loaded.exists,
          messages: loaded.summary.messageCount,
          status: loaded.summary.status,
        });
      }
      return await origLoadSession(...args);
    };
  }

  // Patch handlePrompt for activity tracking + stale session recovery
  const origPrompt = bindInternalHandler(server, s.handlePrompt);
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
      beginHarnessTurn(promptText ?? undefined, storage);
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
        completeHarnessTurn(storage);
        return slashResult;
      }

      try {
        const result = await withRuntimeStorageContext(
          { workspaceRoot: sessionWorkspace.workspaceRoot, sessionId: params.sessionId },
          () => origPrompt(...args)
        );
        // Only count successful prompts
        manager.touch(params.sessionId);
        completeHarnessTurn(storage);
        return result;
      } catch (err) {
        failHarnessTurn(err, storage);
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
            return await s.handlePrompt?.(
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
  const origCancel = bindInternalHandler(server, s.handleCancel);
  if (origCancel) {
    s.handleCancel = async (...args: unknown[]) => {
      const params = args[0] as { sessionId?: string };
      if (params?.sessionId) manager.touch(params.sessionId);
      return origCancel(...args);
    };
  }

  const origSetSessionMode = bindInternalHandler(server, s.handleSetSessionMode);
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
    const sessionWorkspace = sessionWorkspaces.get(params.sessionId) ?? {
      config: activeConfig,
      workspaceRoot: activeWorkspaceRoot,
    };
    s.sessions.delete(params.sessionId);
    sessionWorkspaces.delete(params.sessionId);
    if (!info) {
      return { error: `Session not found: ${params.sessionId}` };
    }
    const persisted = closeSessionState(sessionWorkspace.workspaceRoot, params.sessionId, {
      mode: info.mode,
      agent: sessionWorkspace.config.agent.name,
      environment: "acp",
      lifecycle: readHarnessLifecycle(getRuntimeStorage({
        workspaceRoot: sessionWorkspace.workspaceRoot,
        sessionId: params.sessionId,
      })),
    });
    return {
      closed: true,
      sessionId: params.sessionId,
      messages: info.messageCount,
      persisted,
    };
  };

  // Add listSessions method
  s.handleListSessions = async (..._args: unknown[]) => {
    const persisted = listSessions(activeWorkspaceRoot);
    const activeById = new Map(manager.list().map((session) => [session.sessionId, session]));
    const merged = persisted.map((session) => ({
      ...session,
      active: activeById.has(session.sessionId),
      ...(activeById.get(session.sessionId) ?? {}),
    }));
    for (const active of activeById.values()) {
      if (!persisted.some((session) => session.sessionId === active.sessionId)) {
        const storage = getRuntimeStorage({ workspaceRoot: activeWorkspaceRoot, sessionId: active.sessionId });
        merged.push({
          ...active,
          active: true,
          path: storage.sessionDir,
          updatedAt: active.lastActivityAt,
          status: "active",
        });
      }
    }
    return { sessions: merged, total: merged.length };
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

  const session = options.server.sessions.get(options.params.sessionId);
  const agentConfig = session
    ? options.server.agentConfigs.get(session.agentName)
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
