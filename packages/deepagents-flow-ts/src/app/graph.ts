/**
 * 默认 Flow Graph —— 标准 LangGraph ReAct（显式节点，非 createReactAgent 黑盒）。
 *
 *   START → prepare → think(model.bindTools) ──(toolsCondition)──┐
 *                      ▲                                        ├─ 有 tool_calls → tools(ToolNode + onToolCall 透出) → think
 *                      └────────────────────────────────────────┘
 *                                               └─ 无 tool_calls → respond(流式) → END
 *
 * 工具集来自 FlowRuntime.allTools（app-ts 通用 + flow 自补 bash/fs/search/demo/mcp-bridge + native MCP）。
 * 状态用标准消息流（MessagesAnnotation），自动进 FileCheckpointSaver（跨重启恢复 + interrupt/resume）。
 *
 * CreateFlowGraphConfig 是 FlowRuntime 的**结构子集** —— getFlowTopology 反射拓扑时传最小子集
 * （空 tools + MemorySaver），不加载 MCP、不需要凭证、不 invoke 节点。
 */

import { randomUUID } from "node:crypto";
import {
  StateGraph,
  START,
  END,
  MemorySaver,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import { resolveModel, logger, type AppConfig } from "../vendor/runtime/index.js";
import { hasModelCredentials } from "./compaction.js";
import {
  invokeWithResilience,
  resolveLlmResilience,
} from "../runtime/llm-resilience.js";
import { FlowStateAnnotation, type FlowState } from "./state.js";
import type { FlowCallbacks } from "../surfaces/flow-types.js";

const log = logger.child("flow-graph");

export interface CreateFlowGraphConfig {
  /** 绑给 think 的工具集（FlowRuntime.allTools）；反射拓扑时可空。 */
  allTools?: StructuredTool[];
  /** checkpointer（FlowRuntime.checkpointer）；反射拓扑时默认 MemorySaver。 */
  checkpointer?: BaseCheckpointSaver;
  /** AppConfig（resolveModel 用）；反射拓扑时可空。 */
  config?: AppConfig;
  /** 系统提示词（think 注入 SystemMessage）。 */
  systemPrompt?: string;
  callbacks?: FlowCallbacks;
}

type BoundModel = { invoke: (m: BaseMessage[]) => Promise<AIMessage> };

function withSystemPrompt(messages: BaseMessage[], systemPrompt: string): BaseMessage[] {
  if (!systemPrompt) return messages;
  if (messages.length > 0 && messages[0]?._getType?.() === "system") return messages;
  return [new SystemMessage(systemPrompt), ...messages];
}

export function createFlowGraph(config: CreateFlowGraphConfig = {}) {
  const { allTools = [], checkpointer = new MemorySaver(), callbacks } = config;

  const hasCreds = hasModelCredentials(config.config);
  let boundModel: BoundModel | null = null;
  if (config.config && hasCreds) {
    try {
      const raw = resolveModel(config.config);
      if (raw && typeof raw !== "string") {
        boundModel = (
          raw as unknown as { bindTools: (t: StructuredTool[]) => BoundModel }
        ).bindTools(allTools);
      }
    } catch (err) {
      log.warn("resolveModel/bindTools failed", { error: String(err) });
    }
  }

  // prepare：首次把 input 转 HumanMessage 加入 messages（历史由 checkpointer 恢复）。
  // 多轮上下文压缩见 examples/dev-agent（compactHistory + updateState + RemoveMessage 替换模式）。
  const prepareNode = async (state: FlowState): Promise<Partial<FlowState>> => {
    if (!state.input) return {};
    return { messages: [new HumanMessage(state.input)] };
  };

  // think：bindTools 的模型决定调工具（AIMessage.tool_calls）还是直接回答。
  const thinkNode = async (state: FlowState): Promise<Partial<FlowState>> => {
    if (!boundModel || !hasCreds) {
      // 无凭证 fallback：直接回显输入为回答（不调工具，保证图始终可跑）
      return {
        messages: [new AIMessage({ content: `(无模型凭证，回显输入)\n${state.input}` })],
        steps: ["think#fallback: no model"],
      };
    }
    try {
      const { shortTimeoutMs } = resolveLlmResilience(config.config);
      const ai = await invokeWithResilience(
        boundModel,
        withSystemPrompt(state.messages, config.systemPrompt ?? ""),
        { timeoutMs: shortTimeoutMs, label: "think 调模型", retryLabel: "think LLM", config: config.config }
      );
      return {
        messages: [ai],
        steps: [`think: ${(ai.tool_calls ?? []).length} tool_calls`],
      };
    } catch (err) {
      // 重试用尽仍失败（限流/网络/超时）→ 降级回显，保证图收敛而非整图抛错
      log.warn("think invoke failed → fallback", { error: String(err), apiOk: false });
      return {
        messages: [new AIMessage({ content: `(模型调用失败，回显输入)\n${state.input}` })],
        steps: ["think#fallback: invoke error"],
      };
    }
  };

  // tools：ToolNode 执行 + onToolCall 三态透出（in_progress → completed/failed）。
  const toolNode = new ToolNode(allTools);
  const toolsNode = async (state: FlowState): Promise<Partial<FlowState>> => {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const calls = (last?.tool_calls ?? []) as Array<{
      id?: string;
      name: string;
      args: Record<string, unknown>;
    }>;
    for (const c of calls) {
      if (callbacks?.onToolCall && c.id) {
        await callbacks.onToolCall({
          toolCallId: c.id,
          toolName: c.name,
          args: c.args,
          status: "in_progress",
        });
      }
    }
    const result = (await toolNode.invoke({ messages: state.messages })) as {
      messages?: ToolMessage[];
    };
    const toolMsgs = result?.messages ?? [];
    for (const tm of toolMsgs) {
      if (callbacks?.onToolCall) {
        const failed = tm.status === "error";
        const text = typeof tm.content === "string" ? tm.content : JSON.stringify(tm.content);
        await callbacks.onToolCall({
          toolCallId: tm.tool_call_id,
          toolName: tm.name ?? "",
          args: {},
          status: failed ? "failed" : "completed",
          ...(failed ? { error: text } : { result: text }),
        });
      }
    }
    return { messages: toolMsgs, steps: toolMsgs.map((t) => `tool:${t.name ?? "?"}`) };
  };

  // respond：取最后 AIMessage 文本，经 onToken 流式发 + 设 output。
  const respondNode = async (state: FlowState): Promise<Partial<FlowState>> => {
    const last = state.messages[state.messages.length - 1];
    const text = last && typeof last.content === "string" ? (last.content as string) : "";
    if (text && callbacks?.onToken) await callbacks.onToken(text);
    return { output: text, steps: ["respond"] };
  };

  const graph = new StateGraph(FlowStateAnnotation)
    .addNode("prepare", prepareNode)
    .addNode("think", thinkNode)
    .addNode("tools", toolsNode)
    .addNode("respond", respondNode)
    .addEdge(START, "prepare")
    .addEdge("prepare", "think")
    .addConditionalEdges("think", toolsCondition, {
      tools: "tools",
      [END]: "respond",
    })
    .addEdge("tools", "think")
    .addEdge("respond", END)
    .compile({ checkpointer });

  log.info("Flow graph compiled: prepare → think ↔ tools → respond (LangGraph ReAct)", {
    tools: allTools.length,
  });
  return graph;
}

/** 跑一次默认 flow（one-shot，每次新 thread；续接历史走 StatefulFlow）。 */
export async function executeFlow(
  input: string,
  deps: {
    allTools: StructuredTool[];
    checkpointer: BaseCheckpointSaver;
    config: AppConfig;
    systemPrompt: string;
  },
  callbacks: FlowCallbacks = {}
): Promise<{ output: string; steps: string[] }> {
  const graph = createFlowGraph({ ...deps, callbacks });
  const threadId = randomUUID();
  const result = (await graph.invoke(
    { input, messages: [] } as unknown as FlowState,
    { configurable: { thread_id: threadId } }
  )) as FlowState;
  return { output: result.output ?? "", steps: result.steps ?? [] };
}
