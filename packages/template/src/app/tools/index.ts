/**
 * Tool Registry
 *
 * Creates all custom tools and exports them as an array for createDeepAgent().
 * Each tool is built with @langchain/core/tools `tool()` helper so it's
 * fully compatible with deepagents' tool system.
 *
 * The platform-bound tools (platform_api, agent_variable, mcp_tool_bridge)
 * are created by createTools() which receives the runtime context.
 */

import type { StructuredTool } from "@langchain/core/tools";
import { httpRequestTool } from "./http-request.tool.js";
import { jsonUtilsTool } from "./json-utils.tool.js";
import { agentMemoryTool } from "./agent-memory.tool.js";
import { conversationHistoryTool } from "./conversation-history.tool.js";
import { checkpointTool } from "./checkpoint.tool.js";
import { createPlatformApiTool } from "./platform-api.tool.js";
import { createAgentVariableTool } from "./agent-variable.tool.js";
import { createMcpBridgeTool } from "./mcp-bridge.tool.js";
import { createRuntimeInfoTool } from "./runtime-info.tool.js";
import type { PlatformClient } from "../../runtime/platform/platform-client.js";
import type { MCPManager } from "../../runtime/platform/mcp-manager.js";
import type { VariableManager } from "../../runtime/platform/variable-manager.js";

export interface ToolContext {
  /** PlatformClient when platform credentials are configured, null in local-only mode */
  platformClient: PlatformClient | null;
  mcpManager: MCPManager;
  variableManager: VariableManager;
  workspaceRoot: string;
}

/**
 * Create the full list of custom tools for the agent.
 * Called from agent-factory at agent creation time so tools
 * can be bound to live runtime instances.
 */
export function createTools(ctx: ToolContext): StructuredTool[] {
  return [
    // Stateless tools (no runtime binding needed)
    httpRequestTool,
    jsonUtilsTool,
    agentMemoryTool,
    conversationHistoryTool,
    checkpointTool,
    createRuntimeInfoTool({ workspaceRoot: ctx.workspaceRoot }),

    // Platform-bound tools (created with live context)
    createPlatformApiTool(ctx.platformClient),
    createAgentVariableTool(ctx.variableManager),
    createMcpBridgeTool(ctx.mcpManager),
  ];
}
