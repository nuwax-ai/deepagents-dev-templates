/**
 * Flow 工具集组装 —— 通用工具 + flow 自补工具 + native MCP 工具。
 *
 * 模板自包含:通用工具（http_request/json_utils/platform_api/agent_variable）与 flow 自管的
 * bash/fs/search/demo/mcp-bridge 都在本目录（app/tools/），再合并 runtime-context 经
 * @langchain/mcp-adapters 加载的 native MCP 工具（ctx.mcpTools）。新增工具放本目录、在此注册。
 */

import type { StructuredTool } from "@langchain/core/tools";
import type { RuntimeContext } from "../../runtime/index.js";
import { httpRequestTool } from "./http-request.tool.js";
import { jsonUtilsTool } from "./json-utils.tool.js";
import { createPlatformApiTool } from "./platform-api.tool.js";
import { createAgentVariableTool } from "./agent-variable.tool.js";
import { createBashTool } from "./bash.tool.js";
import { createFsTools } from "./fs.tool.js";
import { createSearchTools } from "./search.tool.js";
import { createDemoTools } from "./demo.tool.js";
import { createMcpBridgeTool } from "./mcp-bridge.tool.js";
import type { FlowSandboxPolicy } from "../../runtime/fs/sandbox.js";

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
