/**
 * ACP Session Lifecycle Hooks
 *
 * Builds the `DeepAgentsServerHooks` object passed to deepagents-acp's
 * `DeepAgentsServer`. This replaces the previous private-internals monkey-patch:
 * every behavior now rides on upstream's public hook surface
 * (`configureSession` / `onPrompt` / `onPromptComplete` / `onPromptError` /
 * `onSessionClosed`) — no reaching into server privates, no
 * `acp-server-internals` reflection.
 *
 * Responsibilities:
 *  - per-session `cwd` → workspace switch (returns a SessionConfigurePatch)
 *  - ACP session `mcpServers` forwarding
 *  - durable session state + harness-turn lifecycle (begin/complete/fail)
 *  - slash-command interception (before the agent runs)
 */

import type {
  DeepAgentsServerHooks,
  SessionConfigurePatch,
  DeepAgentConfig,
} from "deepagents-acp";
import {
  loadConfig,
  resolveConfiguredWorkspaceRoot,
  type AppConfig,
  type ACPSessionConfig,
} from "../../runtime/config/config-loader.js";
import { logger } from "../../runtime/logger.js";
import type { MCPManager } from "../../runtime/platform/mcp-manager.js";
import { forwardAcpMcpServers } from "../../runtime/platform/mcp-acp-adapter.js";
import {
  beginHarnessTurn,
  completeHarnessTurn,
  failHarnessTurn,
  readHarnessLifecycle,
} from "../../runtime/storage/harness-lifecycle.js";
import {
  appendRuntimeMessage,
  closeSessionState,
  ensureSessionState,
  getRuntimeStorage,
  withRuntimeStorageContext,
} from "../../runtime/storage/runtime-storage.js";
import { buildACPAgentConfigWithMcpAsync } from "./config-builder.js";
import { SessionManager } from "./session-manager.js";
import { handleAcpSlashCommand, type AcpConnection } from "./slash-command-handler.js";

/** Per-session context the hooks need across the prompt lifecycle. */
interface SessionContext {
  config: AppConfig;
  workspaceRoot: string;
  mcpManager: MCPManager;
  agentConfig?: DeepAgentConfig;
  mode: string;
}

/**
 * When deepagents-acp adds native MCP forwarding, set
 * `ACP_MCP_FORWARDING=disabled` to avoid double-loading.
 */
function isAcpMcpForwardingEnabled(): boolean {
  return process.env.ACP_MCP_FORWARDING !== "disabled";
}

export interface AcpSessionHooksOptions {
  initialConfig: AppConfig;
  initialWorkspaceRoot: string;
  initialMcpManager: MCPManager;
  /**
   * The bootstrap agent config. Used as the fallback source of tool info for
   * slash commands in sessions that don't rebuild an agentConfig via a cwd
   * switch (the common path), so /status etc. still see a populated tool list.
   */
  initialAgentConfig?: DeepAgentConfig;
  configPath?: string;
  sessionConfig?: ACPSessionConfig;
  /** When true, a session's `cwd` param switches the active workspace root. */
  useSessionCwd: boolean;
}

/**
 * Build the ACP server lifecycle hooks plus an in-memory SessionManager (used
 * for activity tracking / counts). Pass `hooks` to `new DeepAgentsServer(...)`.
 */
export function createAcpSessionHooks(opts: AcpSessionHooksOptions): {
  hooks: DeepAgentsServerHooks;
  manager: SessionManager;
} {
  const log = logger.child("session-lifecycle");
  const manager = new SessionManager();
  const mcpForwardingEnabled = isAcpMcpForwardingEnabled();
  const sessionCtx = new Map<string, SessionContext>();

  if (!mcpForwardingEnabled) {
    log.info("ACP MCP forwarding disabled via ACP_MCP_FORWARDING=disabled");
  }

  // The default SessionContext for sessions that don't switch workspace via
  // cwd. Built once as a factory so the ctxFor fallback and the configureSession
  // initializer can't drift apart.
  const initialCtx = (mode: string = "agent"): SessionContext => ({
    config: opts.initialConfig,
    workspaceRoot: opts.initialWorkspaceRoot,
    mcpManager: opts.initialMcpManager,
    mode,
  });

  const ctxFor = (sessionId: string): SessionContext =>
    sessionCtx.get(sessionId) ?? initialCtx();

  const hooks: DeepAgentsServerHooks = {
    async configureSession(ctx) {
      let active: SessionContext = initialCtx(ctx.mode ?? "agent");
      let patch: SessionConfigurePatch | undefined;

      // Per-session cwd → rebuild config + agent config rooted at the requested
      // directory, and hand the new agent config back to the server as a patch.
      const cwd = typeof ctx.params.cwd === "string" ? ctx.params.cwd : undefined;
      if (opts.useSessionCwd && cwd) {
        const requestedConfig = loadConfig({
          configPath: opts.configPath,
          sessionConfig: { ...opts.sessionConfig, cwd },
          workspaceRoot: cwd,
        });
        const requestedRoot = resolveConfiguredWorkspaceRoot(requestedConfig, cwd);
        if (requestedRoot !== opts.initialWorkspaceRoot) {
          const { agentConfig, mcpManager } = await buildACPAgentConfigWithMcpAsync(
            requestedConfig,
            requestedRoot,
            { ...opts.sessionConfig, cwd: requestedRoot }
          );
          // deepagents-acp does not drive LangGraph interrupts; path protection
          // rides on the forwarded `permissions` array instead.
          agentConfig.interruptOn = {};
          active = {
            config: requestedConfig,
            workspaceRoot: requestedRoot,
            mcpManager,
            agentConfig,
            mode: ctx.mode ?? "agent",
          };
          patch = { workspaceRoot: requestedRoot, agentConfig };
          log.info("Using ACP session cwd as workspace root", {
            workspaceRoot: requestedRoot,
          });
        }
      }

      // Forward session-scoped MCP servers to the active MCP manager.
      if (mcpForwardingEnabled && ctx.params.mcpServers) {
        forwardAcpMcpServers(ctx.params.mcpServers, active.mcpManager);
      }

      sessionCtx.set(ctx.sessionId, active);
      manager.track(ctx.sessionId, active.mode);
      ensureSessionState(
        getRuntimeStorage({ workspaceRoot: active.workspaceRoot, sessionId: ctx.sessionId }),
        {
          mode: active.mode,
          agent: active.config.agent.name,
          environment: "acp",
          ...(ctx.phase === "load" ? { recovered: true } : {}),
        }
      );

      return patch;
    },

    async onPrompt(ctx) {
      const sc = ctxFor(ctx.sessionId);
      const storage = getRuntimeStorage({
        workspaceRoot: sc.workspaceRoot,
        sessionId: ctx.sessionId,
      });
      if (ctx.promptText) {
        appendRuntimeMessage({ role: "user", content: ctx.promptText }, storage);
      }

      const slashResult = await withRuntimeStorageContext(
        { workspaceRoot: sc.workspaceRoot, sessionId: ctx.sessionId },
        () =>
          handleAcpSlashCommand({
            promptText: ctx.promptText,
            conn: ctx.conn as AcpConnection | undefined,
            config: sc.config,
            workspaceRoot: sc.workspaceRoot,
            mode: sc.mode,
            sessionId: ctx.sessionId,
            // Fall back to the bootstrap agent's tools when this session has
            // no per-session agentConfig (the common no-cwd-switch path).
            tools: sc.agentConfig?.tools ?? opts.initialAgentConfig?.tools,
          })
      );

      if (slashResult) {
        // A handled slash command short-circuits the agent, so the
        // harness-lifecycle middleware (beforeAgent/afterAgent) never runs for
        // it. Record a single begin+complete turn here so the lifecycle still
        // reflects the interaction. A slash handler that throws falls through to
        // onPromptError, which records the failure.
        beginHarnessTurn(ctx.promptText ?? undefined, storage);
        completeHarnessTurn(storage);
        manager.touch(ctx.sessionId);
        return slashResult;
      }

      // Normal prompt (or unrecognized "/..."): the agent runs and its
      // harness-lifecycle middleware owns the turn lifecycle (begin/complete/
      // fail). Beginning a turn here would double-count counters.turns because
      // the middleware's beforeAgent begins it too. onPromptError remains the
      // backstop for failures the middleware can't see (e.g. tool errors).
      return undefined;
    },

    async onPromptComplete(ctx) {
      const sc = ctxFor(ctx.sessionId);
      manager.touch(ctx.sessionId);
      completeHarnessTurn(
        getRuntimeStorage({ workspaceRoot: sc.workspaceRoot, sessionId: ctx.sessionId })
      );
    },

    async onPromptError(ctx) {
      const sc = ctxFor(ctx.sessionId);
      failHarnessTurn(
        ctx.error,
        getRuntimeStorage({ workspaceRoot: sc.workspaceRoot, sessionId: ctx.sessionId })
      );
    },

    async onSessionClosed(ctx) {
      const sc = ctxFor(ctx.sessionId);
      const info = manager.close(ctx.sessionId);
      const storage = getRuntimeStorage({
        workspaceRoot: sc.workspaceRoot,
        sessionId: ctx.sessionId,
      });
      closeSessionState(sc.workspaceRoot, ctx.sessionId, {
        mode: info?.mode ?? sc.mode,
        agent: sc.config.agent.name,
        environment: "acp",
        lifecycle: readHarnessLifecycle(storage),
      });
      sessionCtx.delete(ctx.sessionId);
    },
  };

  log.info("ACP session hooks created", {
    features: [
      "configureSession",
      "onPrompt",
      "onPromptComplete",
      "onPromptError",
      "onSessionClosed",
    ],
  });

  return { hooks, manager };
}
