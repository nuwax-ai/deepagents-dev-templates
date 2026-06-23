/**
 * ACP Server — 让工作流图成为请求路径（与具体图解耦）。
 *
 * 关键 seam：deepagents-acp 的 `onPrompt` 钩子在 agent 运行前触发，
 * 返回 `{ stopReason }` 即短路 agent。主入口经 materializeFlow 传入 StatefulFlow；
 * examples 仍可能传入 legacy function executor。
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
} from "../../libs/deepagents-acp/index.js";
import {
  logger,
  setLogSession,
  resolveModel,
  type AppConfig,
  type ACPSessionConfig,
} from "../../runtime/index.js";
import {
  loadSessionConfigFromEnv,
  mergeAcpSessionConfig,
  resolveAcpSessionConfig,
} from "./session-config.js";
import {
  logConfigureSessionDiagnostics,
  logStartupAcpEnvDiagnostics,
} from "./session-diagnostics.js";
import {
  runInAcpPromptCycle,
  traceFlowCallbacks,
  traceFlowRun,
  logAcpPromptStart,
  logAcpPromptEnd,
  logPromptComplete,
} from "../../runtime/session-trace.js";
import type {
  FlowExecutor,
  StatefulFlow,
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

/** ACP 流式回传统计（写入 prompt_end）。 */
interface AcpStreamStats {
  streamed: boolean;
  streamChars: number;
  tokenChunks: number;
}

function createAcpStreamStats(): AcpStreamStats {
  return { streamed: false, streamChars: 0, tokenChunks: 0 };
}

/**
 * 组装 ACP onPrompt 的 callbacks：流式推送 + tool trace。
 * 所有调试日志在此层注入，flow 图本身无感知。
 */
function buildAcpCallbacks(
  conn: AcpConnection,
  sessionId: string,
  stats: AcpStreamStats,
  inflightTools: Map<string, ToolCallEvent>,
  signal?: AbortSignal
): ReturnType<typeof traceFlowCallbacks> {
  return traceFlowCallbacks(
    {
      onToken: (token) => {
        stats.streamed = true;
        stats.streamChars += token.length;
        stats.tokenChunks += 1;
        return streamText(conn, sessionId, token, "agent");
      },
      onToolCall: async (e) => {
        await emitToolCall(conn, sessionId, e);
        if (e.status === "in_progress") {
          inflightTools.set(e.toolCallId, e);
        } else {
          inflightTools.delete(e.toolCallId);
        }
      },
      onStage: (e) => streamText(conn, sessionId, formatStage(e), "thought"),
      onPlan: (e) => emitPlan(conn, sessionId, e),
      ...(signal ? { signal } : {}),
    },
    { sessionId, threadId: sessionId }
  );
}

async function failInflightToolsOnCancel(
  conn: AcpConnection,
  sessionId: string,
  inflightTools: Map<string, ToolCallEvent>
): Promise<void> {
  for (const e of inflightTools.values()) {
    try {
      await conn.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: e.toolCallId,
          status: "failed",
          content: [
            {
              type: "content",
              content: { type: "text", text: "已取消（客户端 session/cancel）" },
            },
          ],
        },
      });
    } catch (tuErr) {
      log.warn("cancel: tool_call_update 发送失败", {
        sessionId,
        toolCallId: e.toolCallId,
        error: String(tuErr),
      });
    }
  }
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
   * 单 executor 模式：StatefulFlow（主路径）；legacy function executor 仅 examples 兼容。
   * 与 createExecutor 二选一；createExecutor 优先。
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

export {
  acpMcpToRecord,
  sessionConfigFromParams,
  resolveAcpSessionConfig,
  extractSystemPromptFromParams,
  coalesceSystemPromptValue,
  loadSessionConfigFromEnv,
  mergeAcpSessionConfig,
} from "./session-config.js";

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
  /** 记录每轮 onPrompt 起始时间，供 onPromptComplete 写 prompt_complete。 */
  const promptTurnStartedAt = new Map<string, number>();

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
      // configureSession 未触发时的最后兜底：合并 env + 进程 cwd。
      const fallbackConfig = mergeAcpSessionConfig(loadSessionConfigFromEnv(), {
        cwd: process.cwd(),
      });
      const built = await options.createExecutor({
        sessionConfig: configured?.sessionConfig ?? fallbackConfig,
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
      // 无论单/多 executor，都先绑定 per-session 日志（幂等）。
      setLogSession(ctx.sessionId);
      if (!options.createExecutor) return undefined;
      const { sessionConfig, workspaceRoot, fromParams } = resolveAcpSessionConfig(ctx.params);
      logConfigureSessionDiagnostics({
        sessionId: ctx.sessionId,
        phase: ctx.phase,
        params: ctx.params,
        fromParams,
        merged: sessionConfig,
        workspaceRoot,
      });
      sessionConfigs.set(ctx.sessionId, { sessionConfig, workspaceRoot });
      try {
        const built = await options.createExecutor({ sessionConfig, workspaceRoot });
        // session/load 重配时先 dispose 旧资源，避免泄漏。
        // best-effort：旧实例 dispose 抛错不应阻断新实例就位（与 onSessionClosed 一致）。
        try {
          await sessions.get(ctx.sessionId)?.dispose?.();
        } catch (dispErr) {
          log.warn("configureSession: 旧 executor dispose 失败", {
            sessionId: ctx.sessionId,
            error: String(dispErr),
          });
        }
        sessions.set(ctx.sessionId, built);
        sessionFailures.delete(ctx.sessionId);
        log.info("configureSession → per-session runtime", {
          sessionId: ctx.sessionId,
          phase: ctx.phase,
          cwd: workspaceRoot,
          mcpServers: sessionConfig.mcpServers ? Object.keys(sessionConfig.mcpServers) : [],
          systemPromptChars: sessionConfig.systemPrompt?.trim().length ?? 0,
          model: sessionConfig.model,
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
      // configureSession 未触发时（部分 host）仍保证 per-session log writer 就位。
      setLogSession(sessionId);
      const promptStartedAt = Date.now();
      promptTurnStartedAt.set(sessionId, promptStartedAt);
      // ① 协议层：收到 session/prompt
      logAcpPromptStart({ sessionId, query: text });

      const executor = await resolveExecutor(sessionId);
      if (!executor) {
        log.warn("onPrompt: no executor available for session", { sessionId });
        promptTurnStartedAt.delete(sessionId);
        return undefined;
      }
      const isStateful = typeof executor !== "function";
      const durableResume =
        isStateful && typeof (executor as StatefulFlow).hasStarted === "function";

      return runInAcpPromptCycle(
        { sessionId, startedAt: promptStartedAt, query: text },
        async () => {
          const stats = createAcpStreamStats();
          const inflightTools = new Map<string, ToolCallEvent>();
          const callbacks = buildAcpCallbacks(
            conn,
            sessionId,
            stats,
            inflightTools,
            ctx.signal
          );

          const endTurn = (meta: Omit<Parameters<typeof logAcpPromptEnd>[0], "sessionId" | "startedAt">) => {
            logAcpPromptEnd({
              sessionId,
              startedAt: promptStartedAt,
              streamed: stats.streamed,
              streamChars: stats.streamChars,
              tokenChunks: stats.tokenChunks,
              ...meta,
            });
          };

          try {
            if (isStateful) {
              const flow = executor as StatefulFlow;
              const resuming = durableResume
                ? await flow.hasStarted!(sessionId)
                : fallbackResume.has(sessionId);
              const mode = resuming ? "resume" : "query";
              // ② flow 执行（tool/stage/LLM trace 经 callbacks 注入）
              const res = await traceFlowRun(
                "flow.run",
                {
                  sessionId,
                  threadId: sessionId,
                  mode,
                  input: text,
                  resuming,
                  isStateful: true,
                },
                () =>
                  flow.run(
                    resuming ? { resume: text } : { query: text },
                    sessionId,
                    callbacks
                  )
              );
              if (res.status === "interrupted") {
                if (!durableResume) fallbackResume.add(sessionId);
                endTurn({
                  stopReason: "end_turn",
                  flowStatus: "interrupted",
                  questionChars: res.question?.length ?? 0,
                });
                if (res.question) {
                  await streamText(conn, sessionId, res.question);
                }
                return { stopReason: "end_turn" as StopReason };
              }
              if (!durableResume) fallbackResume.delete(sessionId);
              if (!stats.streamed && res.answer) await streamText(conn, sessionId, res.answer);
              if (res.footer) await streamText(conn, sessionId, res.footer);
              endTurn({
                stopReason: "end_turn",
                flowStatus: res.status,
                answerChars: res.answer?.length ?? 0,
              });
              return { stopReason: "end_turn" as StopReason };
            }

            const result = await traceFlowRun(
              "flow.run",
              {
                sessionId,
                mode: "query",
                input: text,
                isStateful: false,
              },
              () => (executor as FlowExecutor)(text, callbacks)
            );
            if (!stats.streamed && result.answer) await streamText(conn, sessionId, result.answer);
            if (result.footer) await streamText(conn, sessionId, result.footer);
            endTurn({
              stopReason: "end_turn",
              flowStatus: "done",
              answerChars: result.answer?.length ?? 0,
            });
            return { stopReason: "end_turn" as StopReason };
          } catch (err) {
            if ((err as Error)?.name === "AbortError" || ctx.signal?.aborted) {
              endTurn({ stopReason: "cancelled" });
              await failInflightToolsOnCancel(conn, sessionId, inflightTools);
              return { stopReason: "cancelled" as StopReason };
            }
            endTurn({ stopReason: "end_turn", error: String(err) });
            if (!durableResume) fallbackResume.delete(sessionId);
            await streamText(conn, sessionId, "抱歉，处理您的问题时出现错误。");
            return { stopReason: "end_turn" as StopReason };
          }
        }
      );
    },

    /** ③ 协议层：deepagents-acp 确认 turn 已结束（含 onPrompt 短路路径）。 */
    async onPromptComplete(ctx) {
      const startedAt = promptTurnStartedAt.get(ctx.sessionId);
      logPromptComplete({
        sessionId: ctx.sessionId,
        stopReason: ctx.stopReason,
        promptMs: startedAt != null ? Date.now() - startedAt : 0,
      });
      promptTurnStartedAt.delete(ctx.sessionId);
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

/** 启动 Flow ACP 服务（stdio）。主路径 StatefulFlow；per-session 工厂见 createExecutor。 */
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
  logStartupAcpEnvDiagnostics();

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
