/**
 * ACP Server — 让工作流图成为请求路径（与具体图解耦）。
 *
 * 关键 seam：deepagents-acp 的 `onPrompt` 钩子在 agent 运行前触发，
 * 返回 `{ stopReason }` 即短路 agent。我们在这里跑传入的 FlowExecutor，
 * 把回答经 `conn` 流式推给客户端，然后短路——deep agent 永不进入请求路径。
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
} from "deepagents-acp";
import { logger, resolveModel, type AppConfig } from "deepagents-app-ts/runtime";
import type { FlowExecutor, ToolCallEvent } from "../flow-types.js";

const log = logger.child("flow-acp");

/** ACP 连接的最小接口：向客户端推 sessionUpdate（agent_message_chunk / tool_call[_update]）。 */
interface AcpConnection {
  sessionUpdate(params: {
    sessionId: string;
    update:
      | { sessionUpdate: "agent_message_chunk"; content: { type: "text"; text: string } }
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
  text: string
): Promise<void> {
  if (!text) return;
  await conn.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
    },
  });
}

export interface FlowAcpOptions {
  executor: FlowExecutor;
  /** 用于 throwaway agent 的身份/模型（agent 永不运行） */
  appConfig: AppConfig;
  debug?: boolean;
}

/** 启动 Flow ACP 服务（stdio）。任意 FlowExecutor 都能插进来。 */
export async function bootstrapFlowAcp(options: FlowAcpOptions): Promise<void> {
  if (options.debug) {
    process.env.LOG_LEVEL = "debug";
  }
  const { executor, appConfig } = options;

  log.info("Flow ACP bootstrapping", {
    agent: appConfig.agent.name,
    model: `${appConfig.model.provider}:${appConfig.model.name}`,
  });

  // 极简 throwaway agent —— onPrompt 会短路，它永不进入请求路径。
  const agentConfig = {
    name: appConfig.agent.name,
    description: appConfig.agent.description,
    model: resolveModel(appConfig),
    tools: [],
  } as unknown as DeepAgentConfig;

  const hooks: DeepAgentsServerHooks = {
    async onPrompt(ctx) {
      const query = ctx.promptText?.trim();
      if (!query) {
        return undefined; // 空输入：交回服务器默认处理
      }
      const conn = ctx.conn as AcpConnection;
      log.info("onPrompt → flow", {
        sessionId: ctx.sessionId,
        query: query.slice(0, 100),
      });

      try {
        // 跟踪是否流式：流式则只补 footer，非流式则整段发 answer。
        let streamed = false;
        const result = await executor(query, {
          onToken: (token) => {
            streamed = true;
            return streamText(conn, ctx.sessionId, token);
          },
          onToolCall: (e) => emitToolCall(conn, ctx.sessionId, e),
        });
        if (!streamed && result.answer) {
          await streamText(conn, ctx.sessionId, result.answer);
        }
        if (result.footer) {
          await streamText(conn, ctx.sessionId, result.footer);
        }
        return { stopReason: "end_turn" as StopReason };
      } catch (err) {
        log.error("onPrompt flow failed", { error: String(err) });
        await streamText(conn, ctx.sessionId, "抱歉，处理您的问题时出现错误。");
        return { stopReason: "end_turn" as StopReason };
      }
    },
  };

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
