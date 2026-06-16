/**
 * Flow 工具集组装 —— 通用工具 + flow 自补工具 + skills/subagent + native MCP 工具。
 *
 * 模板自包含:通用工具（http_request/json_utils/platform_api/agent_variable）与 flow 自管的
 * bash/fs/search/demo/mcp-bridge 都在本目录（app/tools/），再合并 runtime-context 经
 * @langchain/mcp-adapters 加载的 native MCP 工具（ctx.mcpTools）。
 * 另接：load_skill（渐进式读 SKILL.md）+ task（委派声明式 subagent）。新增工具放本目录、在此注册。
 */

import type { StructuredTool } from "@langchain/core/tools";
import type {
  RuntimeContext,
  DiscoveredSkill,
  DiscoveredSubAgent,
} from "../../runtime/index.js";
import { httpRequestTool } from "./http-request.tool.js";
import { jsonUtilsTool } from "./json-utils.tool.js";
import { createPlatformApiTool } from "./platform-api.tool.js";
import { createAgentVariableTool } from "./agent-variable.tool.js";
import { createBashTool } from "./bash.tool.js";
import { createFsTools } from "./fs.tool.js";
import { createSearchTools } from "./search.tool.js";
import { createDemoTools } from "./demo.tool.js";
import { createMcpBridgeTool } from "./mcp-bridge.tool.js";
import { createSkillTool } from "./skill.tool.js";
import { createTaskTool } from "./task.tool.js";
import type { FlowSandboxPolicy } from "../../runtime/fs/sandbox.js";

export function createFlowTools(
  ctx: RuntimeContext,
  opts: {
    workspaceRoot: string;
    policy: FlowSandboxPolicy;
    /** 已发现的 skills → 暴露 load_skill 工具 + 提示词清单。 */
    skills?: DiscoveredSkill[];
    /** 已发现的声明式 subagent → 暴露 task 委派工具。 */
    subAgents?: DiscoveredSubAgent[];
  }
): StructuredTool[] {
  const { workspaceRoot, policy, skills = [], subAgents = [] } = opts;

  // 与 cwd 无关的通用工具（无状态，主 agent 与子代理共享同实例）。
  const reused: StructuredTool[] = [
    httpRequestTool,
    jsonUtilsTool,
    createPlatformApiTool(ctx.platformClient),
    createAgentVariableTool(ctx.variableManager),
  ];
  const skillTools = skills.length ? [createSkillTool(skills)] : [];

  // 按工作目录构建一套工具（bash/fs/search 沙箱受限于该 cwd）——**不含 task，防递归**。
  // 主 agent 用 workspaceRoot；子代理（task.tool）按各自 workdir 重建。
  const buildTools = (wsRoot: string): StructuredTool[] => [
    ...reused,
    createBashTool({ workspaceRoot: wsRoot, policy }),
    ...createFsTools({ workspaceRoot: wsRoot, policy }),
    ...createSearchTools({ workspaceRoot: wsRoot, policy }),
    ...createDemoTools(),
    createMcpBridgeTool(ctx.mcpServerConfigs),
    ...ctx.mcpTools,
    ...skillTools,
  ];

  const tools = buildTools(workspaceRoot);
  if (subAgents.length) {
    tools.push(
      createTaskTool({
        subAgents,
        config: ctx.config,
        parentWorkspaceRoot: workspaceRoot,
        buildTools,
      })
    );
  }
  return tools;
}
