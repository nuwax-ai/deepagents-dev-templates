/**
 * ACP Server — 让工作流图成为请求路径（与具体图解耦）。
 *
 * 关键 seam：deepagents-acp 的 `onPrompt` 钩子在 agent 运行前触发，
 * 返回 `{ stopReason }` 即短路 agent。我们在这里跑传入的 FlowExecutor，
 * 把回答经 `conn` 流式推给客户端，然后短路——deep agent 永不进入请求路径。
 *
 * per-session 配置（D）：`createExecutor` 工厂 + `configureSession` 钩子让 ACP `session/new`
 * 下发的 `cwd` / `mcpServers` / `model` 经 loadConfig（ACP 最高优先级）装配**每会话独立** runtime；
 * `onSessionClosed` 释放该会话资源（MCP stdio 子进程）。未传 createExecutor 时退回单 executor 模式。
 *
 * DeepAgentsServer 仍要求一个 agentConfig（其内部 createDeepAgent 用它），
 * 所以我们给一个极简、零自定义工具的 throwaway agent，它从不被调用。
 */

import {
  DeepAgentsServer,
  formatToolCallTitle,
  getToolCallKind,
  type DeepAgentConfig,
  type DeepAgentsServerHooks,
  type StopReason,
} from "../deepagents-acp/index.js";
import {
  logger,
  resolveModel,
  type AppConfig,
  type ACPSessionConfig,
} from "../../runtime/index.js";
import type {
  FlowExecutor,
  StatefulFlow,
  FlowCallbacks,
  ToolCallEvent,
  StageEvent,
  PlanEvent,
} from "../../core/flow-types.js";

const log = logger.child("flow-acp");

/** ACP 连接的最小接口：向客户端推 sessionUpdate。 */
interface AcpConnection {
  sessionUpdate(params: {
    sessionId: string;
    update:
      | { sessionUpdate: "agent_message_chunk"; content: { type: "text"; text: string } }
      | { sessionUpdate: "agent_thought_chunk"; content: { type: "text"; text: string } }
      | {
          sessionUpdate: "plan";
          entries: Array<{
            content: string;
            priority?: "high" | "medium" | "low";
            status: "pending" | "in_progress" | "completed" | "skipped";
          }>;
        }
      | {
          sessionUpdate: "tool_call";
          toolCallId: string;
          title: string;
          kind: string;
          status: string;
          input?: unknown;
        }
      | {
          sessionUpdate: "tool_call_update";
          toolCallId: string;
          status: string;
          content?: unknown;
          output?: string;
        };
  }): Promise<void>;
}

/** 把 FlowExecutor 的 ToolCallEvent 翻译成 ACP tool_call / tool_call_update 推给客户端。 */
async function emitToolCall(
  conn: AcpConnection,
  sessionId: string,
  e: ToolCallEvent
): Promise<void> {
  if (e.status === "in_progress") {
    await conn.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: e.toolCallId,
        title: formatToolCallTitle(e.toolName, e.args),
        kind: getToolCallKind(e.toolName),
        status: "in_progress",
        input: e.args,
      },
    });
    return;
  }
  // completed | failed
  const update: {
    sessionUpdate: "tool_call_update";
    toolCallId: string;
    status: string;
    content?: unknown;
    output?: string;
  } = {
    sessionUpdate: "tool_call_update",
    toolCallId: e.toolCallId,
    status: e.status,
  };
  if (e.status === "completed" && e.result != null) {
    const text =
      typeof e.result === "string" ? e.result : JSON.stringify(e.result, null, 2);
    update.content = [{ type: "content", content: { type: "text", text } }];
    update.output = text;
  } else if (e.status === "failed" && e.error) {
    update.content = [{ type: "content", content: { type: "text", text: e.error } }];
  }
  await conn.sessionUpdate({ sessionId, update });
}

async function streamText(
  conn: AcpConnection,
  sessionId: string,
  text: string,
  kind: "agent" | "thought" = "agent"
): Promise<void> {
  if (!text) return;
  await conn.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: kind === "thought" ? "agent_thought_chunk" : "agent_message_chunk",
      content: { type: "text", text },
    },
  });
}

/** 结构化 Plan → ACP sessionUpdate: plan。 */
async function emitPlan(
  conn: AcpConnection,
  sessionId: string,
  e: PlanEvent
): Promise<void> {
  if (!e.entries.length) return;
  await conn.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: "plan",
      entries: e.entries,
    },
  });
}

/** 长任务阶段事件 → thought chunk（不污染主回答区）。 */
function formatStage(e: StageEvent): string {
  const pos = e.index && e.total ? ` [${e.index}/${e.total}]` : "";
  const detail = e.detail ? ` · ${e.detail}` : "";
  return `\n▸${pos} ${e.stage}${detail}\n`;
}

/** per-session 装配产物：executor + 资源释放钩子。 */
export interface SessionExecutor {
  executor: FlowExecutor | StatefulFlow;
  /** 释放该 session 的运行时资源（如 MCP stdio 子进程）。session 关闭时调用。 */
  dispose?: () => Promise<void>;
}

export interface FlowAcpOptions {
  /**
   * 单 executor 模式：one-shot FlowExecutor 或支持 HITL 的 StatefulFlow，所有 session 共用
   * （无 per-session 配置）。与 createExecutor 二选一；createExecutor 优先。
   */
  executor?: FlowExecutor | StatefulFlow;
  /**
   * per-session 工厂模式：按 ACP session 的 cwd / mcpServers / model 装配**每会话独立** runtime
   * （ACP 最高优先级，见 loadConfig 第 6 层）。在 configureSession 阶段调用，onSessionClosed 释放。
   */
  createExecutor?: (args: {
    sessionConfig: ACPSessionConfig;
    workspaceRoot: string;
  }) => Promise<SessionExecutor>;
  /** throwaway agent 的身份/模型（agent 永不运行） */
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
 * 构造 flow surface 的三个 ACP hook（configureSession / onPrompt / onSessionClosed）。
 *
 * 从 bootstrapFlowAcp 抽出，便于在测试中直接调用 hook、注入假 executor / 假 conn，
 * 无需启动真实 stdio server。bootstrapFlowAcp 调它再把 hooks 交给 DeepAgentsServer——行为不变。
 *
 * onPrompt 把 ACP cancel controller 的 signal 经 callbacks.signal 透传进 flow，
 * flow 再交给 `graph.stream({signal})`：client 取消时图运行快速 reject，onPrompt 的 catch 收尾。
 */
export function createFlowHooks(options: FlowAcpOptions): DeepAgentsServerHooks {
  // per-session executor 缓存（createExecutor 模式）；单 executor 模式下恒空。
  const sessions = new Map<string, SessionExecutor>();
  // configureSession 下发的 workspace/cwd 也缓存下来；若 hook 未能立即建好 executor,
  // 后续懒建也必须沿用同一 session 配置，不能退回进程 cwd。
  const sessionConfigs = new Map<
    string,
    { sessionConfig: ACPSessionConfig; workspaceRoot: string }
  >();
  const sessionFailures = new Map<string, string>();
  // 一个会话 = 一个主题：老式 flow（未实现 hasStarted）的「等回复」内存兜底，按 sessionId 跟踪。
  // 实现了 hasStarted 的 flow 优先从 checkpointer 推断续跑（跨进程/IDE 重启仍准）。
  const fallbackResume = new Set<string>();

  /** 取该 session 的 executor：优先 per-session 缓存，回退单 executor；createExecutor 模式下缺失则懒建。 */
  async function resolveExecutor(
    sessionId: string
  ): Promise<FlowExecutor | StatefulFlow | undefined> {
    const cached = sessions.get(sessionId);
    if (cached) return cached.executor;
    if (options.createExecutor) {
      const failure = sessionFailures.get(sessionId);
      if (failure) {
        throw new Error(`ACP session runtime 初始化失败: ${failure}`);
      }
      const configured = sessionConfigs.get(sessionId);
      // configureSession 未触发时的最后兜底：只能用于 host 未发 session/new 的场景。
      const built = await options.createExecutor({
        sessionConfig: configured?.sessionConfig ?? { cwd: process.cwd() },
        workspaceRoot: configured?.workspaceRoot ?? process.cwd(),
      });
      sessions.set(sessionId, built);
      return built.executor;
    }
    return options.executor;
  }

  return {
    // session/new | session/load：按 ACP cwd/mcpServers/model 装配 per-session runtime。
    async configureSession(ctx) {
      if (!options.createExecutor) return undefined;
      const { sessionConfig, workspaceRoot } = sessionConfigFromParams(ctx.params);
      sessionConfigs.set(ctx.sessionId, { sessionConfig, workspaceRoot });
      try {
        const built = await options.createExecutor({ sessionConfig, workspaceRoot });
        // session/load 重配时先 dispose 旧资源，避免泄漏。
        await sessions.get(ctx.sessionId)?.dispose?.();
        sessions.set(ctx.sessionId, built);
        sessionFailures.delete(ctx.sessionId);
        log.info("configureSession → per-session runtime", {
          sessionId: ctx.sessionId,
          phase: ctx.phase,
          cwd: workspaceRoot,
          mcpServers: sessionConfig.mcpServers ? Object.keys(sessionConfig.mcpServers) : [],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sessionFailures.set(ctx.sessionId, message);
        log.error("configureSession failed; session runtime disabled until reconfigured", {
          sessionId: ctx.sessionId,
          error: message,
        });
      }
      // 让 deepagents-acp 内置 backend 也用同一 workspace 根。
      return { workspaceRoot };
    },

    async onPrompt(ctx) {
      const text = ctx.promptText?.trim();
      if (!text) {
        return undefined; // 空输入：交回服务器默认处理
      }
      const conn = ctx.conn as AcpConnection;
      const sessionId = ctx.sessionId;

      const executor = await resolveExecutor(sessionId);
      if (!executor) {
        log.warn("onPrompt: no executor available for session", { sessionId });
        return undefined;
      }
      // executor 是 function ⇒ one-shot FlowExecutor；是对象（有 run）⇒ 支持 HITL 的 StatefulFlow。
      const isStateful = typeof executor !== "function";
      const durableResume =
        isStateful && typeof (executor as StatefulFlow).hasStarted === "function";

      // 跟踪是否流式：流式则只补 footer/question，非流式则整段发。
      let streamed = false;
      // 跟踪本轮已 start、未 end 的 tool_call：cancel 时遍历发终止 update，
      // 避免客户端 UI 上工具调用永远挂着「进行中」（abort 时收不到 on_tool_end）。
      const inflightTools = new Map<string, ToolCallEvent>();
      const callbacks: FlowCallbacks = {
        onToken: (token) => {
          streamed = true;
          return streamText(conn, sessionId, token, "agent");
        },
        onToolCall: async (e) => {
          await emitToolCall(conn, sessionId, e);
          if (e.status === "in_progress") {
            inflightTools.set(e.toolCallId, e);
          } else {
            // completed | failed：已结束，移出 in-flight 集合
            inflightTools.delete(e.toolCallId);
          }
        },
        // 阶段进度作为 thought chunk，与主回答区分。
        onStage: (e) => streamText(conn, sessionId, formatStage(e), "thought"),
        onPlan: (e) => emitPlan(conn, sessionId, e),
        // ACP cancel signal → graph.stream({signal})，取消时图运行快速 reject。
        ...(ctx.signal ? { signal: ctx.signal } : {}),
      };

      try {
        if (isStateful) {
          const flow = executor as StatefulFlow;
          // 该 session 是否已开题：持久化 flow 读 checkpointer（已有 checkpoint ⇒ 续跑），否则查内存兜底。
          const resuming = durableResume
            ? await flow.hasStarted!(sessionId)
            : fallbackResume.has(sessionId);
          log.info(resuming ? "onPrompt → resume" : "onPrompt → flow(stateful)", {
            sessionId,
            durable: durableResume,
            text: text.slice(0, 100),
          });
          const res = await flow.run(
            resuming ? { resume: text } : { query: text },
            sessionId,
            callbacks
          );
          if (res.status === "interrupted") {
            if (!durableResume) fallbackResume.add(sessionId); // 老式 flow：内存记「等回复」
            // interrupt 问题是下一轮交互提示；即使前面已流式输出报告正文，也要发出。
            if (res.question) {
              await streamText(conn, sessionId, res.question);
            }
            return { stopReason: "end_turn" as StopReason };
          }
          if (!durableResume) fallbackResume.delete(sessionId); // 跑到底，清兜底状态
          if (!streamed && res.answer) await streamText(conn, sessionId, res.answer);
          if (res.footer) await streamText(conn, sessionId, res.footer);
          return { stopReason: "end_turn" as StopReason };
        }

        // one-shot FlowExecutor
        log.info("onPrompt → flow", { sessionId, query: text.slice(0, 100) });
        const result = await (executor as FlowExecutor)(text, callbacks);
        if (!streamed && result.answer) await streamText(conn, sessionId, result.answer);
        if (result.footer) await streamText(conn, sessionId, result.footer);
        return { stopReason: "end_turn" as StopReason };
      } catch (err) {
        // 客户端 session/cancel：协议要求以 StopReason::Cancelled 响应原 prompt
        // （acp.d.ts:1051）。signal 被 abort 时底层图运行以 AbortError reject——
        // 这里捕获后返回 cancelled，而非把取消当成普通错误返回 end_turn。
        if ((err as Error)?.name === "AbortError" || ctx.signal?.aborted) {
          log.info("onPrompt cancelled by client", { sessionId, inflight: inflightTools.size });
          // 给 in-flight tool_call 发合法终止状态（failed + 取消说明），避免客户端 UI 悬挂「进行中」。
          // 注意：ToolCallStatus 枚举只有 pending|in_progress|completed|failed，无 cancelled
          // （客户端会本地标记 cancelled，但 agent 侧用 failed 表达「非正常终止」才是合法值）。
          for (const e of inflightTools.values()) {
            await conn.sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: e.toolCallId,
                status: "failed",
                content: [
                  { type: "content", content: { type: "text", text: "已取消（客户端 session/cancel）" } },
                ],
              },
            });
          }
          return { stopReason: "cancelled" as StopReason };
        }
        log.error("onPrompt flow failed", { error: String(err) });
        if (!durableResume) fallbackResume.delete(sessionId); // 出错清兜底状态，避免卡在 resume
        await streamText(conn, sessionId, "抱歉，处理您的问题时出现错误。");
        return { stopReason: "end_turn" as StopReason };
      }
    },

    // session 关闭：释放 per-session 资源（MCP stdio 子进程等）+ 清兜底状态。
    async onSessionClosed(ctx) {
      const entry = sessions.get(ctx.sessionId);
      if (entry) {
        try {
          await entry.dispose?.();
        } catch {
          /* best-effort teardown */
        }
        sessions.delete(ctx.sessionId);
      }
      sessionConfigs.delete(ctx.sessionId);
      sessionFailures.delete(ctx.sessionId);
      fallbackResume.delete(ctx.sessionId);
      log.info("session closed", { sessionId: ctx.sessionId });
    },
  };
}

/** 启动 Flow ACP 服务（stdio）。任意 FlowExecutor / per-session 工厂都能插进来。 */
export async function bootstrapFlowAcp(options: FlowAcpOptions): Promise<void> {
  if (options.debug) {
    process.env.LOG_LEVEL = "debug";
  }
  const { appConfig } = options;

  log.info("Flow ACP bootstrapping", {
    agent: appConfig.agent.name,
    model: `${appConfig.model.provider}:${appConfig.model.name}`,
    mode: options.createExecutor ? "per-session" : "single-executor",
  });

  // 极简 throwaway agent —— onPrompt 会短路，它永不进入请求路径。
  const agentConfig = {
    name: appConfig.agent.name,
    description: appConfig.agent.description,
    model: resolveModel(appConfig),
    tools: [],
  } as unknown as DeepAgentConfig;

  const hooks = createFlowHooks(options);

  const server = new DeepAgentsServer({
    agents: agentConfig,
    serverName: appConfig.agent.name,
    serverVersion: appConfig.agent.version || "0.1.0",
    debug: process.env.LOG_LEVEL === "debug",
    hooks,
  });

  log.info("Starting Flow ACP server (workflow short-circuits agent via onPrompt)");
  await server.start();
}
