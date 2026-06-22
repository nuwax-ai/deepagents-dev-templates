#!/usr/bin/env node

/**
 * deepagents-flow-ts — 通用工作流编排模板入口
 *
 * 模式：
 *   (默认) / acp        启动 ACP 服务（stdio）—— 供 nuwaclaw/Zed/JetBrains
 *   flow "<输入>"       命令行跑一次默认 flow（测试用）
 *   flow -i             交互模式
 *   graph               导出默认图拓扑（JSON；加 --mermaid 出 Mermaid 源）
 *   capabilities        输出能力分层 + 可用工具/MCP/skills（无凭证，供开发 Agent 查询）
 *   sessions            列出已持久化的会话（thread id）
 *
 * 默认图是标准 LangGraph ReAct（prepare → think ↔ tools → respond）。
 * 工具/会话/压缩/Skills/Subagent 经 FlowRuntime（框架原生能力 + 能力分层配置）驱动。
 * 选项：--config <path>  --debug  -h/--help
 */

import { config as loadDotenv } from "dotenv";
import { loadFlowConfig } from "./runtime/flow-config.js";
import { destroyRuntimeContext, setLogAgent } from "./runtime/index.js";
import {
  createRuntimeContextAsync,
  resolveSystemPrompt,
  resolveSkillsPaths,
  discoverSkills,
  discoverSubAgents,
  renderSkillsSection,
  renderSubagentsSection,
  type AppConfig,
  type ACPSessionConfig,
} from "./runtime/index.js";
import { createFlowTools } from "./app/flow-tools.js";
import { getFlowSandboxPolicy } from "./runtime/fs/sandbox.js";
import { createFileCheckpointer } from "./runtime/services/file-checkpoint-saver.js";
import type { FlowRuntime } from "./runtime/flow-runtime.js";
import { bootstrapFlowAcp } from "./surfaces/acp/server.js";
import { runFlowCli } from "./surfaces/cli/run.js";
import { runCapabilities } from "./surfaces/cli/capabilities.js";
import { runSessions } from "./surfaces/cli/sessions.js";
import { resolveFlow, type FlowDef } from "./app/flows/index.js";
import { createStatefulFlow } from "./surfaces/stateful-flow.js";
import type { FlowExecutor, StatefulFlow } from "./core/flow-types.js";

/**
 * createFlowRuntime —— 组合根(原 `compose/flow-runtime.ts` 折入入口)。
 * 装配 runtime 基础设施 + app 工具(createFlowTools)→ FlowRuntime,注入图节点。
 * 唯一跨层向下装配点(取 app/flow-tools);故在 root(index)而非 runtime,免 runtime→app 倒挂。
 */
export async function createFlowRuntime(
  appConfig: AppConfig,
  options: { sessionConfig?: ACPSessionConfig; workspaceRoot?: string } = {}
): Promise<FlowRuntime> {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const ctx = await createRuntimeContextAsync(appConfig, options.sessionConfig, workspaceRoot);
  const sandbox = getFlowSandboxPolicy(appConfig);

  const skillsPaths = resolveSkillsPaths(appConfig);
  const skills = discoverSkills(appConfig, workspaceRoot);
  const subAgents = discoverSubAgents(appConfig, workspaceRoot);
  const progressiveSkills = appConfig.skills.progressiveLoading;

  // skills → load_skill 工具;subAgents → task 委派工具(沙箱按 workspaceRoot / 各自 workdir)。
  const allTools = createFlowTools(ctx, {
    workspaceRoot,
    policy: sandbox,
    skills: progressiveSkills ? skills : [],
    subAgents,
  });

  // 系统提示词追加「Available Skills」「Subagents」清单。
  const baseSystemPrompt = resolveSystemPrompt(appConfig, options.sessionConfig, workspaceRoot);
  const sections = [
    renderSkillsSection(skills, progressiveSkills),
    renderSubagentsSection(subAgents),
  ].filter(Boolean);
  const systemPrompt = sections.length
    ? `${baseSystemPrompt}\n\n${sections.join("\n\n")}`
    : baseSystemPrompt;

  // 文件后端 checkpointer(跨重启恢复 + interrupt/resume 持久化)。
  const checkpointer = createFileCheckpointer(appConfig, workspaceRoot);

  return {
    config: appConfig,
    ctx,
    allTools,
    systemPrompt,
    skillsPaths,
    skills,
    subAgents,
    sandbox,
    workspaceRoot,
    checkpointer,
  };
}

/**
 * materializeFlow —— 把 FlowDef 物化成 surface 能用的 FlowExecutor | StatefulFlow。
 *
 * `stateful-recipe` 在此（root，能 import surfaces）调 createStatefulFlow 把 recipe 包成 StatefulFlow
 * （规避 app/libs → surfaces 分层违规）；oneshot / stateful-custom 直接调各自 createExecutor。
 * createStatefulFlow 全工程仅此一处调用。
 */
function materializeFlow(def: FlowDef, runtime: FlowRuntime): FlowExecutor | StatefulFlow {
  if (def.kind === "stateful-recipe") {
    return createStatefulFlow({
      ...def.recipe(runtime),
      checkpointer: runtime.checkpointer,
      appConfig: runtime.config,
    });
  }
  return def.createExecutor(runtime);
}

interface ParsedArgs {
  command: "acp" | "flow" | "graph" | "capabilities" | "sessions";
  query?: string;
  configPath?: string;
  debug: boolean;
  interactive: boolean;
  help: boolean;
  /** graph 命令:输出 Mermaid 源而非 JSON */
  mermaid: boolean;
  /** sessions 子命令：list（默认）/ delete */
  sessionsAction?: "list" | "delete";
  /** sessions delete 的目标 thread id */
  sessionsId?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    command: "acp",
    debug: false,
    interactive: false,
    help: false,
    mermaid: false,
  };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--debug") args.debug = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--interactive" || a === "-i") args.interactive = true;
    else if (a === "--mermaid") args.mermaid = true;
    else if (a === "--config" && argv[i + 1]) args.configPath = argv[++i];
    else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    } else positional.push(a);
  }

  const first = positional[0];
  if (first === "graph") {
    args.command = "graph";
  } else if (first === "capabilities") {
    args.command = "capabilities";
  } else if (first === "sessions") {
    args.command = "sessions";
    if (positional[1] === "delete") args.sessionsAction = "delete";
    else if (positional[1] === "list") args.sessionsAction = "list";
    args.sessionsId = positional[2];
  } else if (first === "flow") {
    args.command = "flow";
    args.query = positional.slice(1).join(" ") || undefined;
  } else if (first && first !== "acp") {
    args.command = "flow";
    args.query = positional.join(" ");
  }

  return args;
}

const HELP = `deepagents-flow-ts — 通用工作流编排模板

用法:
  deepagents-flow-ts                启动 ACP 服务（默认，stdio）
  deepagents-flow-ts acp            同上
  deepagents-flow-ts flow "<输入>"  命令行跑一次默认 flow
  deepagents-flow-ts flow -i        交互模式
  deepagents-flow-ts graph          导出默认图拓扑（JSON；加 --mermaid 出 Mermaid 源）
  deepagents-flow-ts capabilities   输出能力分层 + 可用工具/MCP/skills（无凭证）
  deepagents-flow-ts sessions       列出已持久化的会话（thread id）
  deepagents-flow-ts sessions delete <id>  删除某个已持久化会话

默认图是标准 LangGraph ReAct（prepare → think ↔ tools → respond）。
工具/会话/压缩经 FlowRuntime（框架原生 + 能力分层）驱动。

选项:
  --config <path>   指定配置文件（默认 config/flow-agent.config.json）
  --debug           调试日志
  -h, --help        显示帮助
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return;
  }

  // graph：导出图拓扑（静态，不运行图、不需要凭证）——对接可视化 / 文档。
  if (args.command === "graph") {
    const { raw } = loadFlowConfig({ configPath: args.configPath });
    const activeFlow = typeof raw.activeFlow === "string" ? raw.activeFlow : undefined;
    const { nodes, edges, mermaid } = await resolveFlow(activeFlow).getTopology();
    process.stdout.write(
      args.mermaid ? mermaid + "\n" : JSON.stringify({ nodes, edges }, null, 2) + "\n"
    );
    return;
  }

  // capabilities / sessions：静态查询（不加载 MCP、不需凭证）——供开发 Agent 查询配置。
  if (args.command === "capabilities") {
    await runCapabilities();
    return;
  }
  if (args.command === "sessions") {
    await runSessions({ action: args.sessionsAction, id: args.sessionsId });
    return;
  }

  // ACP 模式下凭证由 host(Zed/JetBrains) 注入；dotenv 仅作本地兜底。
  loadDotenv();

  // server 身份用一次轻量配置解析（loadFlowConfig 不触 MCP；MCP 在 createFlowRuntime
  // 内按 session 加载）。
  const baseConfig = loadFlowConfig({ configPath: args.configPath });
  // 设全局 agent 名（log 文件名前缀），早于任何 session log。
  setLogAgent(baseConfig.appConfig.agent.name);

  if (args.command === "flow") {
    // CLI one-shot：单 runtime 共用即可，无需 per-session。
    const runtime = await createFlowRuntime(baseConfig.appConfig);
    const activeFlow =
      typeof baseConfig.raw.activeFlow === "string" ? baseConfig.raw.activeFlow : undefined;
    const executor = materializeFlow(resolveFlow(activeFlow), runtime);
    await runFlowCli(executor, {
      query: args.query,
      interactive: args.interactive,
    });
    return;
  }

  // ACP（默认）模式：per-session 工厂。每个 ACP session 按 session/new 下发的
  // cwd / mcpServers / model 装配**独立** runtime（ACP 最高优先级，见 loadConfig 第 6 层）；
  // onSessionClosed 时经 dispose 释放该 session 的 MCP stdio 子进程。
  await bootstrapFlowAcp({
    appConfig: baseConfig.appConfig,
    debug: args.debug,
    createExecutor: async ({ sessionConfig, workspaceRoot }) => {
      const { appConfig, raw } = loadFlowConfig({
        configPath: args.configPath,
        workspaceRoot,
        sessionConfig,
      });
      const runtime = await createFlowRuntime(appConfig, { sessionConfig, workspaceRoot });
      const activeFlow = typeof raw.activeFlow === "string" ? raw.activeFlow : undefined;
      return {
        executor: materializeFlow(resolveFlow(activeFlow), runtime),
        dispose: async () => {
          await destroyRuntimeContext(runtime.ctx).catch(() => {
            /* best-effort teardown of MCP stdio procs */
          });
        },
      };
    },
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
