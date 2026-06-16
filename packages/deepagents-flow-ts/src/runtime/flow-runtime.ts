/**
 * FlowRuntime —— 把 app-ts 的散装 runtime 能力收成一处，注入图节点。
 *
 * 包装 createRuntimeContextAsync（拿 mcpTools/mcpServerConfigs/platformClient/variableManager + 平台 MCP
 * hydration），叠加 resolveSystemPrompt / resolveSkillsPaths / discoverSubAgents /
 * FlowSandboxPolicy / FileCheckpointSaver / createFlowTools。
 *
 * 图节点经 FlowRuntime 拿到 allTools（bindTools）/ systemPrompt / checkpointer，
 * 不再各自裸调 resolveModel / appConfig。
 */

import type { StructuredTool } from "@langchain/core/tools";
import {
  createRuntimeContextAsync,
  resolveSystemPrompt,
  resolveSkillsPaths,
  discoverSubAgents,
  type AppConfig,
  type ACPSessionConfig,
  type RuntimeContext,
  type DiscoveredSubAgent,
} from "../vendor/runtime/index.js";
import { createFlowTools } from "../app/tools/index.js";
import { getFlowSandboxPolicy, type FlowSandboxPolicy } from "./sandbox.js";
import { FileCheckpointSaver, createFileCheckpointer } from "./file-checkpoint-saver.js";

export interface FlowRuntime {
  config: AppConfig;
  /** runtime context（含 mcpServerConfigs/mcpTools/platformClient/variableManager + 平台 MCP hydration）。 */
  ctx: RuntimeContext;
  /** 全部工具（app-ts 通用 + flow 自补 + native MCP）—— 供 think 节点 bindTools。 */
  allTools: StructuredTool[];
  /** 解析后的系统提示词（ACP > config > prompts/ 文件 > fallback）。 */
  systemPrompt: string;
  /** 已发现的 skills 目录（deepagents progressive skills）。 */
  skillsPaths: string[];
  /** 已发现的声明式 subagent（.agents/agents/&lt;name&gt;/AGENT.md）。 */
  subAgents: DiscoveredSubAgent[];
  /** 工具沙箱策略（bash/fs 执行前校验）。 */
  sandbox: FlowSandboxPolicy;
  workspaceRoot: string;
  /** 文件后端 checkpointer（跨重启恢复 + interrupt/resume 持久化）。 */
  checkpointer: FileCheckpointSaver;
}

export async function createFlowRuntime(
  appConfig: AppConfig,
  options: { sessionConfig?: ACPSessionConfig; workspaceRoot?: string } = {}
): Promise<FlowRuntime> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const ctx = await createRuntimeContextAsync(appConfig, options.sessionConfig, workspaceRoot);
  const sandbox = getFlowSandboxPolicy(appConfig);
  const allTools = createFlowTools(ctx, { workspaceRoot, policy: sandbox });
  const systemPrompt = resolveSystemPrompt(appConfig, options.sessionConfig, workspaceRoot);
  const skillsPaths = resolveSkillsPaths(appConfig);
  const subAgents = discoverSubAgents(appConfig, workspaceRoot);

  // 文件后端 checkpointer：与 createStatefulFlow 共用 resolveSessionDir 口径（见 file-checkpoint-saver）。
  const checkpointer = createFileCheckpointer(appConfig, workspaceRoot);

  return {
    config: appConfig,
    ctx,
    allTools,
    systemPrompt,
    skillsPaths,
    subAgents,
    sandbox,
    workspaceRoot,
    checkpointer,
  };
}
