/**
 * 默认 Flow Graph —— 标准 LangGraph ReAct（显式节点，非 createReactAgent 黑盒）。
 *
 *   START → prepare → think(model.bindTools) ──(toolsCondition)──┐
 *                      ▲                                        ├─ 有 tool_calls → tools(ToolNode + onToolCall 透出) → think
 *                      └────────────────────────────────────────┘
 *                                               └─ 无 tool_calls → respond(流式) → END
 *
 * 本文件**只做「建节点 + 连边」**（图是契约）：4 个节点的实现拆在 `./nodes/`，这里聚合并连线。
 * 工具集来自 FlowRuntime.allTools（内置通用 + flow 自补 bash/fs/search/demo/mcp-bridge + native MCP）。
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
import { toolsCondition } from "@langchain/langgraph/prebuilt";
import type { StructuredTool } from "@langchain/core/tools";
import { logger, type AppConfig } from "../runtime/index.js";
import { FlowStateAnnotation, type FlowState } from "./state.js";
import type { FlowCallbacks } from "../core/flow-types.js";
import { createThinkNode, createRespondNode } from "./nodes/index.js";
import { createPrepareNode, createToolExecNode } from "../libs/nodes/index.js";

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

export function createFlowGraph(config: CreateFlowGraphConfig = {}) {
  const { allTools = [], checkpointer = new MemorySaver(), callbacks } = config;

  // 建节点：prepare 纯函数；think/tools/respond 由工厂承接各自运行时依赖（见 ./nodes/*）。
  const graph = new StateGraph(FlowStateAnnotation)
    .addNode("prepare", createPrepareNode<FlowState>())
    .addNode(
      "think",
      createThinkNode({ config: config.config, allTools, systemPrompt: config.systemPrompt })
    )
    .addNode(
      "tools",
      createToolExecNode<FlowState>({
        tools: allTools,
        callbacks,
        write: (msgs) => ({
          messages: msgs,
          steps: msgs.map((t) => `tool:${t.name ?? "?"}`),
        }),
      })
    )
    .addNode("respond", createRespondNode({ callbacks }))
    // 连边：图的契约（与可视化拓扑一致，见 topology.ts）。
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
): Promise<{ output: string; steps: string[]; messages: FlowState["messages"] }> {
  const graph = createFlowGraph({ ...deps, callbacks });
  const threadId = randomUUID();
  // signal 透传：ACP cancel（callbacks.signal）必须进 graph.invoke 才能在节点边界
  // 中止；节点内 LLM 调用再经 invokeWithResilience(signal) 即时打断（见 think/llm 节点）。
  const result = (await graph.invoke(
    { input, messages: [] } as unknown as FlowState,
    {
      configurable: { thread_id: threadId },
      ...(callbacks?.signal ? { signal: callbacks.signal } : {}),
    }
  )) as FlowState;
  return {
    output: result.output ?? "",
    steps: result.steps ?? [],
    messages: result.messages ?? [],
  };
}
