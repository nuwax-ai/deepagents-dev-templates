/**
 * Flow 工具集组装 —— 自创建跨场景通用工具 + flow 自补工具 + native MCP 工具。
 *
 * flow-ts 自包含（不依赖 deepagents-app-ts）：通用工具（http_request/json_utils/
 * platform_api/agent_variable）从 vendor/app-tools 自创建，叠加 flow 自管的
 * bash/fs/search/demo/mcp-bridge，再合并 runtime-context 经 @langchain/mcp-adapters
 * 加载的 native MCP 工具（ctx.mcpTools）。
 */

import type { StructuredTool } from "@langchain/core/tools";
import type { RuntimeContext } from "../../vendor/runtime/index.js";
import { httpRequestTool } from "../../vendor/app-tools/http-request.tool.js";
import { jsonUtilsTool } from "../../vendor/app-tools/json-utils.tool.js";
import { createPlatformApiTool } from "../../vendor/app-tools/platform-api.tool.js";
import { createAgentVariableTool } from "../../vendor/app-tools/agent-variable.tool.js";
import { createBashTool } from "./bash.tool.js";
import { createFsTools } from "./fs.tool.js";
import { createSearchTools } from "./search.tool.js";
import { createDemoTools } from "./demo.tool.js";
import { createMcpBridgeTool } from "./mcp-bridge.tool.js";
import type { FlowSandboxPolicy } from "../../runtime/sandbox.js";

export function createFlowTools(
  ctx: RuntimeContext,
  opts: { workspaceRoot: string; policy: FlowSandboxPolicy }
): StructuredTool[] {
  const reused: StructuredTool[] = [
    httpRequestTool,
    jsonUtilsTool,
    createPlatformApiTool(ctx.platformClient),
    createAgentVariableTool(ctx.variableManager),
  ];
  const flowBuiltin: StructuredTool[] = [
    createBashTool(opts),
    ...createFsTools(opts),
    ...createSearchTools(opts),
    ...createDemoTools(),
    createMcpBridgeTool(ctx.mcpServerConfigs),
  ];
  return [...reused, ...flowBuiltin, ...ctx.mcpTools];
}
