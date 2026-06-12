/**
 * ACP Server — 让工作流图成为请求路径
 *
 * 关键 seam：deepagents-acp 的 `onPrompt` 钩子在 agent 运行前触发，
 * 返回 `{ stopReason }` 即短路 agent。我们在这里跑 RAG 工作流图，
 * 把回答经 `conn` 流式推给客户端，然后短路——deep agent 永不进入请求路径。
 *
 * DeepAgentsServer 仍要求一个 agentConfig（其内部 createDeepAgent 用它），
 * 所以我们给一个极简、零自定义工具的 throwaway agent，它从不被调用。
 */

import {
  DeepAgentsServer,
  type DeepAgentConfig,
  type DeepAgentsServerHooks,
  type StopReason,
} from "deepagents-acp";
import { logger, resolveModel } from "deepagents-app-ts/runtime";
import { loadRagConfig } from "../../runtime/config.js";
import { executeRAG } from "../../app/graph.js";
import { buildGraphConfig, formatSourcesFooter } from "../../app/run-rag.js";

const log = logger.child("rag-acp");

/** ACP 连接的最小接口：向客户端推流 agent_message_chunk。 */
interface AcpConnection {
  sessionUpdate(params: {
    sessionId: string;
    update: {
      sessionUpdate: "agent_message_chunk";
      content: { type: "text"; text: string };
    };
  }): Promise<void>;
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

export interface RagAcpOptions {
  configPath?: string;
  debug?: boolean;
}

/** 启动 RAG ACP 服务（stdio）。 */
export async function bootstrapRagAcp(options: RagAcpOptions = {}): Promise<void> {
  if (options.debug) {
    process.env.LOG_LEVEL = "debug";
  }

  const loaded = loadRagConfig({ configPath: options.configPath });
  const graphConfig = buildGraphConfig(loaded);

  log.info("RAG ACP bootstrapping", {
    model: `${loaded.appConfig.model.provider}:${loaded.appConfig.model.name}`,
    retrievalTools: graphConfig.retrievalTools,
    configPath: loaded.configPath,
  });

  // 极简 throwaway agent —— onPrompt 会短路，它永不进入请求路径。
  const agentConfig = {
    name: loaded.appConfig.agent.name,
    description: loaded.appConfig.agent.description,
    model: resolveModel(loaded.appConfig),
    tools: [],
  } as unknown as DeepAgentConfig;

  const hooks: DeepAgentsServerHooks = {
    async onPrompt(ctx) {
      const query = ctx.promptText?.trim();
      if (!query) {
        return undefined; // 空输入：交回服务器默认处理
      }
      const conn = ctx.conn as AcpConnection;
      log.info("onPrompt → RAG workflow", {
        sessionId: ctx.sessionId,
        query: query.slice(0, 100),
      });

      try {
        const response = await executeRAG(query, {
          config: { ...graphConfig },
          callbacks: {
            onToken: (token) => streamText(conn, ctx.sessionId, token),
          },
        });
        // 回答正文已通过 onToken 流式推送；这里补上来源脚注。
        await streamText(conn, ctx.sessionId, formatSourcesFooter(response));
        return { stopReason: "end_turn" as StopReason };
      } catch (err) {
        log.error("onPrompt RAG failed", { error: String(err) });
        await streamText(conn, ctx.sessionId, "抱歉，处理您的问题时出现错误。");
        return { stopReason: "end_turn" as StopReason };
      }
    },
  };

  const server = new DeepAgentsServer({
    agents: agentConfig,
    serverName: loaded.appConfig.agent.name,
    serverVersion: loaded.appConfig.agent.version || "0.1.0",
    debug: process.env.LOG_LEVEL === "debug",
    hooks,
  });

  log.info("Starting RAG ACP server (workflow short-circuits agent via onPrompt)");
  await server.start();
}
