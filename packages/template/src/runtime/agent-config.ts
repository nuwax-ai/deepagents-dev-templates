/**
 * Agent Config Builder
 *
 * Composes the configuration parts passed to deepagents' `createDeepAgent()`:
 * model, system prompt, tools, skills, memory, subagents, permissions,
 * interrupt-on, checkpointer, and the middleware chain. Shared by both the
 * standalone agent factory and the ACP server.
 */

import { type AnyBackendProtocol, type FilesystemPermission, createMemoryMiddleware } from "deepagents";
import type { StructuredTool } from "@langchain/core/tools";
import type { AgentMiddleware } from "langchain";
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { type AppConfig, type ACPSessionConfig } from "./config/config-loader.js";
import { createStuckLoopMiddleware } from "./middleware/stuck-loop.js";
import { createPeriodicReminderMiddleware } from "./middleware/periodic-reminder.js";
import { createCostTrackingMiddleware } from "./middleware/cost-tracking.js";
import { createFsPathResolver } from "./middleware/fs-path-resolver.js";
import { createCompactionMiddleware } from "./middleware/compaction.js";
import { createEvictionMiddleware } from "./middleware/eviction.js";
import { createHookMiddleware, getHooks, registerConfiguredHooks } from "../app/hooks/index.js";
import { createProtectedPathsMiddleware } from "./middleware/protected-paths.js";
import { createHarnessLifecycleMiddleware } from "./middleware/harness-lifecycle.js";
import { resolveModel, resolveSummarizerModel } from "./model.js";
import { resolveSystemPrompt, withRuntimeContextPrompt } from "./prompt.js";
import { discoverMemoryFiles, discoverSubAgents, resolveSkillsPaths } from "./discovery.js";
import { resolveSandboxPolicy, buildPermissions, buildInterruptOn, toAbsoluteDenyGlob } from "./permissions.js";

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
  backend?: AnyBackendProtocol,
  /**
   * Checkpointing strategy. Pass `false` for one-shot / REPL invocations
   * (no `thread_id` is provided → a checkpointer would throw on
   * `MemorySaver.put`). Pass `true` or a `BaseCheckpointSaver` instance
   * for ACP / long-running session flows that need HITL pause/resume.
   * Defaults to `true` (with a fresh in-memory `MemorySaver`) for
   * backward compatibility — `DeepAgentsServer` in ACP mode overrides
   * this with its own checkpointer.
   */
  checkpointer: true | false | BaseCheckpointSaver = new MemorySaver()
) {
  // Build custom middleware array from config
  const middleware: AgentMiddleware[] = [];
  const mwConfig = config.middleware;
  registerConfiguredHooks(config.hooks, workspaceRoot);

  middleware.push(createHarnessLifecycleMiddleware());

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
      summarizer: resolveSummarizerModel(config),
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
  const sandbox = resolveSandboxPolicy(config);
  let interruptOn: Record<string, boolean>;
  let permissions: FilesystemPermission[];
  let systemPrompt = withRuntimeContextPrompt(
    resolveSystemPrompt(config, sessionConfig, workspaceRoot),
    workspaceRoot
  );

  // Protected paths middleware: wraps the tool call regardless of mode.
  // Needed because `DeepAgentsServer` in ACP mode drops the `permissions`
  // field from `createDeepAgent`, so the `permissions` array alone
  // cannot protect files. Gated only on the sandbox's denied paths.
  if (sandbox.deniedWritePaths.length > 0) {
    const deniedGlobs = sandbox.deniedWritePaths.map((d) => toAbsoluteDenyGlob(d, workspaceRoot));
    middleware.push(createProtectedPathsMiddleware({ deniedGlobs }));
  }

  if (mode === "yolo") {
    // No HITL. Path restrictions are enforced by the protected-paths
    // middleware (pushed above, regardless of mode) — the `permissions`
    // array is kept here for non-ACP callers and is dropped by
    // DeepAgentsServer in ACP mode anyway.
    interruptOn = {};
    permissions = sandbox.profile === "open"
      ? [{ operations: ["read", "write"], paths: ["/**"], mode: "allow" as const }]
      : buildPermissions(config, workspaceRoot);
  } else if (mode === "plan") {
    // HITL on writes + planning preamble
    interruptOn = buildInterruptOn(config.permissions.interruptOn);
    permissions = buildPermissions(config, workspaceRoot);
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
    permissions = buildPermissions(config, workspaceRoot);
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
    // REPL/one-shot pass `false` here. ACP (DeepAgentsServer) passes a
    // custom checkpointer that supersedes the value returned from
    // buildAgentConfigParts, so the default `true` keeps the existing
    // ACP behavior.
    checkpointer: checkpointer === true ? new MemorySaver() : checkpointer,
    middleware,
  };
}
