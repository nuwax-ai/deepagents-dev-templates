/**
 * Tool Registry
 *
 * Creates all custom tools and exports them as an array for createDeepAgent().
 * Each tool is built with @langchain/core/tools `tool()` helper so it's
 * fully compatible with deepagents' tool system.
 *
 * The platform-bound tools (platform_api, agent_variable)
 * are created by createTools() which receives the runtime context.
 *
 * MCP tools are loaded separately via `loadMcpTools()` in
 * `runtime/platform/mcp-tool-loader.ts` and merged with the builtin tools
 * at agent-creation time. They are registered as native LangChain tools
 * so the agent calls them directly by name — no bridge indirection needed.
 */

import type { StructuredTool } from "@langchain/core/tools";
import { httpRequestTool } from "./http-request.tool.js";
import { jsonUtilsTool } from "./json-utils.tool.js";
import { agentMemoryTool } from "./agent-memory.tool.js";
import { conversationHistoryTool } from "./conversation-history.tool.js";
import { checkpointTool } from "./checkpoint.tool.js";
import { createTaskTool } from "./task.tool.js";
import { createScheduleActionTool } from "./schedule-action.tool.js";
import { createPlatformApiTool } from "./platform-api.tool.js";
import { createAgentVariableTool } from "./agent-variable.tool.js";
import { createRuntimeInfoTool } from "./runtime-info.tool.js";
import type { PlatformClient } from "../../runtime/platform/platform-client.js";
import type { MCPManager } from "../../runtime/platform/mcp-manager.js";
import type { VariableManager } from "../../runtime/platform/variable-manager.js";
import type { AppConfig } from "../../runtime/config/config-loader.js";
import { ActionScheduler, type ToolExecutor } from "../../runtime/scheduler/action-scheduler.js";

export interface ToolContext {
  /** PlatformClient when platform credentials are configured, null in local-only mode */
  platformClient: PlatformClient | null;
  mcpManager: MCPManager;
  variableManager: VariableManager;
  workspaceRoot: string;
  /** Full agent config — passed to config-aware tools like task delegation */
  config: AppConfig;
  /**
   * Callback to invoke a tool by name with given args.
   * Used by schedule_action to execute delayed tool calls in the background.
   * Set by hydrateRuntimeContext after MCP tools load so both builtin and MCP
   * tools are reachable. Reads lazily at execution time, not at schedule time.
   */
  toolExecutor?: ToolExecutor;
  /**
   * Mutable set of tool names the agent is allowed to schedule.
   * Populated with builtin names in createTools(); extended with MCP tool names
   * by hydrateRuntimeContext after MCP tools load.
   */
  schedulableTools?: Set<string>;
  /**
   * Per-session ActionScheduler, lazily created on the first schedule_action
   * call. Owned by the context (not a module singleton) so it is reclaimed when
   * the context is dropped, and torn down by destroyRuntimeContext().
   */
  scheduler?: ActionScheduler;
}

/**
 * Create the full list of custom builtin tools for the agent.
 * Called from agent-factory at agent creation time so tools
 * can be bound to live runtime instances.
 *
 * MCP tools are NOT included here — they are loaded separately
 * via `loadMcpTools()` and passed as `mcpTools` to `buildAgentConfigParts()`.
 */
export function createTools(ctx: ToolContext): StructuredTool[] {
  // Collect all builtin tool instances first (for name validation in schedule_action)
  const builtinTools: StructuredTool[] = [
    httpRequestTool,
    jsonUtilsTool,
    agentMemoryTool,
    conversationHistoryTool,
    checkpointTool,
    createRuntimeInfoTool({ workspaceRoot: ctx.workspaceRoot }),
    createTaskTool(ctx.config, ctx.workspaceRoot),
    createPlatformApiTool(ctx.platformClient),
    createAgentVariableTool(ctx.variableManager),
  ];

  // Mutable set of known schedulable tool names.
  // Starts with builtins; hydrateRuntimeContext adds MCP names after they load.
  const knownTools = new Set(builtinTools.map(t => t.name));
  ctx.schedulableTools = knownTools;

  // Builtin-only fallback executor (used before MCP tools are known).
  const defaultExecutor: ToolExecutor = async (toolName, args) => {
    const target = builtinTools.find(t => t.name === toolName);
    if (target) return String(await target.invoke(args));
    return `Error: tool "${toolName}" not found for scheduled execution`;
  };

  // Lazy executor wrapper — reads ctx.toolExecutor at call time so that
  // hydrateRuntimeContext can wire in an MCP-aware executor after this function
  // returns, and scheduled timers firing later will automatically use it.
  const lazyExecutor: ToolExecutor = (toolName, args) =>
    (ctx.toolExecutor ?? defaultExecutor)(toolName, args);

  const scheduleActionTool = createScheduleActionTool({
    knownTools,
    executor: lazyExecutor,
    // One scheduler per ToolContext (per session): lazily created on first use
    // and cached on ctx so timers survive across tool invocations. Because it
    // lives on ctx (not a module-level Map), it is GC'd when the context is
    // dropped and never cross-wires with a different session sharing the same
    // storage path. The executor is fixed at lazyExecutor (which reads
    // ctx.toolExecutor at fire time), so the caller's executor arg is ignored.
    getScheduler: (storagePath: string): ActionScheduler => {
      if (!ctx.scheduler) {
        ctx.scheduler = new ActionScheduler({ storagePath, executor: lazyExecutor });
      }
      return ctx.scheduler;
    },
  });

  // NOTE: schedule_action's own name is intentionally NOT added to knownTools.
  // Allowing the agent to schedule schedule_action itself would create an
  // unbounded self-perpetuating timer chain (each fire schedules another),
  // with no recursion-depth guard and no way for the agent to cancel the
  // generated ids. It is not a meaningful "delayed" action anyway.

  return [...builtinTools, scheduleActionTool];
}

