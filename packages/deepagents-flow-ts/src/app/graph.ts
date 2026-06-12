/**
 * 默认 Flow Graph —— 通用工作流模板的「框架完整」骨架(非业务、非 RAG)。
 *
 *   START → prepare → think → act → observe → reflect ─(条件边)─┐
 *                          ▲                                  ├─ continue & 未达上限 → think(下一轮)
 *                          └──────────────────────────────────┘
 *                                                     └─ 否则 → respond → END
 *
 * 每个节点演示一个常用编排模式(见各节点文件顶部注释):
 *   prepare 纯逻辑/初始化 · think LLM 节点 · act 工具调用+onToolCall ·
 *   observe state 累积 · reflect 条件边+循环 · respond 流式输出
 * 少用模式(Send 并行 / interrupt / Command / 子图 / checkpointer)见 docs/flow-patterns.md。
 *
 * ⚠️ 节点名不能与 state channel 同名(LangGraph 限制):判定节点叫 reflect(channel 叫 decision)、
 *    思考节点叫 think(channel 叫 plan)。
 * 想改编排?改下面的 addNode / addEdge / addConditionalEdges 即可。真实业务流范例见 examples/rag/。
 */

import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "deepagents-app-ts/runtime";
import { prepareNode } from "./nodes/prepare.js";
import { thinkNode } from "./nodes/think.js";
import { actNode } from "./nodes/act.js";
import { observeNode } from "./nodes/observe.js";
import { reflectNode, routeAfterReflect } from "./nodes/reflect.js";
import { respondNode } from "./nodes/respond.js";
import type { Observation, PlanStep } from "./state.js";
import type { ToolCallEvent } from "../surfaces/flow-types.js";

const log = logger.child("flow-graph");

/** 图的 channels(与 FlowState 字段对齐)。 */
const FlowStateAnnotation = Annotation.Root({
  input: Annotation<string>,
  history: Annotation<BaseMessage[]>,
  attempts: Annotation<number>,
  decision: Annotation<string>,
  plan: Annotation<PlanStep | null>,
  pendingResult: Annotation<Observation | null>,
  observations: Annotation<Observation[]>,
  steps: Annotation<string[]>,
  output: Annotation<string>,
});

type FlowStateType = typeof FlowStateAnnotation.State;

export interface FlowCallbacks {
  onToken?: (token: string) => void | Promise<void>;
  onToolCall?: (e: ToolCallEvent) => void | Promise<void>;
}

export interface CreateFlowGraphConfig {
  appConfig?: AppConfig;
  callbacks?: FlowCallbacks;
}

/** 创建默认 flow 图(编译后的 LangGraph 图)。 */
export function createFlowGraph(config: CreateFlowGraphConfig = {}) {
  const { appConfig, callbacks } = config;
  const graph = new StateGraph(FlowStateAnnotation)
    .addNode("prepare", (s: FlowStateType) => prepareNode(s))
    .addNode("think", async (s: FlowStateType) => thinkNode(s, appConfig))
    .addNode("act", async (s: FlowStateType) => actNode(s, callbacks?.onToolCall))
    .addNode("observe", (s: FlowStateType) => observeNode(s))
    .addNode("reflect", async (s: FlowStateType) => reflectNode(s, appConfig))
    .addNode("respond", async (s: FlowStateType) =>
      respondNode(s, appConfig, callbacks?.onToken)
    )
    .addEdge(START, "prepare")
    .addEdge("prepare", "think")
    .addEdge("think", "act")
    .addEdge("act", "observe")
    .addEdge("observe", "reflect")
    .addConditionalEdges("reflect", routeAfterReflect, {
      think: "think",
      respond: "respond",
    })
    .addEdge("respond", END);

  log.info(
    "Flow graph compiled: START → prepare → think → act → observe → reflect →(cond) think|respond → END"
  );
  return graph.compile();
}

/** 跑一次默认 flow。 */
export async function executeFlow(
  input: string,
  options: { appConfig?: AppConfig; history?: BaseMessage[] } & FlowCallbacks = {}
): Promise<{ output: string; steps: string[]; observations: Observation[] }> {
  const graph = createFlowGraph({
    appConfig: options.appConfig,
    callbacks: { onToken: options.onToken, onToolCall: options.onToolCall },
  });
  const result = await graph.invoke({ input, history: options.history ?? [] });
  return {
    output: result.output ?? "",
    steps: (result.steps ?? []) as string[],
    observations: (result.observations ?? []) as Observation[],
  };
}

export { FlowStateAnnotation };
export type { FlowStateType };
