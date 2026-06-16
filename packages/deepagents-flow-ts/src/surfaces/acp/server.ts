/**
 * ACP Server — flow 工作流接入 ACP 的 surface（与具体图解耦）。
 *
 * 现状（走官方 deepagents-acp）：官方 npm 发布版（≤0.1.12）尚无 ACP 生命周期 hooks
 * （DeepAgentsServerHooks / onPrompt），因此本 surface 暂不短路请求路径——ACP 客户端的
 * prompt 由 DeepAgentsServer 内置的 throwaway agent 接管，flow 本身不进入请求路径。
 * FlowExecutor / per-session runtime（executor / createExecutor）的接线保留在
 * FlowAcpOptions 上，待官方 acp 提供 hooks 后在此重新接入。CLI / 其它非 ACP surface 不受影响。
 *
 * DeepAgentsServer 要求一个 agentConfig（其内部 createDeepAgent 用它），故提供一个
 * 极简、零自定义工具的 throwaway agent。
 */

import { DeepAgentsServer, type DeepAgentConfig } from "deepagents-acp";
import {
  logger,
  resolveModel,
  type AppConfig,
  type ACPSessionConfig,
} from "../../runtime/index.js";
import type { FlowExecutor, StatefulFlow } from "../../core/flow-types.js";

const log = logger.child("flow-acp");

/** per-session 装配产物：executor + 资源释放钩子（待 hooks 接入后使用）。 */
export interface SessionExecutor {
  executor: FlowExecutor | StatefulFlow;
  /** 释放该 session 的运行时资源（如 MCP stdio 子进程）。session 关闭时调用。 */
  dispose?: () => Promise<void>;
}

export interface FlowAcpOptions {
  /**
   * 单 executor 模式：one-shot FlowExecutor 或支持 HITL 的 StatefulFlow。
   * ⚠️ 当前走官方 acp（无 hooks），暂未接入请求路径；待官方 acp 支持 hooks 后恢复短路。
   */
  executor?: FlowExecutor | StatefulFlow;
  /**
   * per-session 工厂模式：按 ACP session 的 cwd / mcpServers / model 装配每会话独立 runtime。
   * ⚠️ 当前走官方 acp（无 hooks），暂未接入；待官方 acp 支持 hooks 后恢复。
   */
  createExecutor?: (args: {
    sessionConfig: ACPSessionConfig;
    workspaceRoot: string;
  }) => Promise<SessionExecutor>;
  /** throwaway agent 的身份/模型 */
  appConfig: AppConfig;
  debug?: boolean;
}

/** ACP session/new 的 mcpServers（数组 [{name,...}] 或 record）→ 我们的 Record<name, cfg>。 */
export function acpMcpToRecord(raw: unknown): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) {
    const rec: Record<string, unknown> = {};
    for (const s of raw) {
      if (s && typeof s === "object" && typeof (s as { name?: unknown }).name === "string") {
        const { name, ...rest } = s as { name: string } & Record<string, unknown>;
        rec[name] = rest;
      }
    }
    return Object.keys(rec).length ? rec : undefined;
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return undefined;
}

/** 从 ACP session/new|load 的 raw params 提取 cwd / mcpServers / model → ACPSessionConfig。 */
export function sessionConfigFromParams(params: Record<string, unknown>): {
  sessionConfig: ACPSessionConfig;
  workspaceRoot: string;
} {
  const cwd = typeof params.cwd === "string" && params.cwd ? params.cwd : process.cwd();
  const mcpServers = acpMcpToRecord(params.mcpServers);
  const model = typeof params.model === "string" ? params.model : undefined;
  const sessionConfig: ACPSessionConfig = {
    cwd,
    ...(mcpServers ? { mcpServers } : {}),
    ...(model ? { model } : {}),
  };
  return { sessionConfig, workspaceRoot: cwd };
}

/**
 * 启动 Flow ACP 服务（stdio）。
 *
 * 当前走官方 deepagents-acp（无 lifecycle hooks）：flow 不短路请求路径，ACP 客户端的
 * prompt 由内置 throwaway agent 接管。executor / createExecutor 暂未使用，
 * 待官方 acp 支持 hooks 后在此接入 onPrompt / configureSession。
 */
export async function bootstrapFlowAcp(options: FlowAcpOptions): Promise<void> {
  if (options.debug) {
    process.env.LOG_LEVEL = "debug";
  }
  const { appConfig } = options;

  log.info("Flow ACP bootstrapping", {
    agent: appConfig.agent.name,
    model: `${appConfig.model.provider}:${appConfig.model.name}`,
    note: "official deepagents-acp (no hooks) — flow not in request path yet",
  });

  // 极简 throwaway agent：官方 acp 内置 createDeepAgent 用它接管请求路径。
  const agentConfig = {
    name: appConfig.agent.name,
    description: appConfig.agent.description,
    model: resolveModel(appConfig),
    tools: [],
  } as unknown as DeepAgentConfig;

  const server = new DeepAgentsServer({
    agents: agentConfig,
    serverName: appConfig.agent.name,
    serverVersion: appConfig.agent.version || "0.1.0",
    debug: process.env.LOG_LEVEL === "debug",
  });

  log.info("Starting Flow ACP server");
  await server.start();
}
