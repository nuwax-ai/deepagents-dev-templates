/**
 * researcher subgraph —— 演示 Subagent（LangGraph 子图作节点）。
 *
 * researcher 是一个独立编译的小图（单个 research 节点：bindTools 模型调工具研究问题）。
 * 可作为父图的节点插入：
 *
 *   const researcher = createResearcherSubgraph(appConfig, allTools);
 *   parentGraph.addNode("research", researcher);   // 子图作节点
 *   parentGraph.addConditionalEdges("think", (s) => needsResearch(s) ? "research" : "respond");
 *
 * 子图有独立 state（messages），运行时父子经共享 channel（messages）映射。
 * 这就是 flow-ts 里 Subagent 的框架原生实现——不新建委托工具，直接用 LangGraph subgraph。
 */

import { StateGraph, START, END, Annotation, messagesStateReducer } from "@langchain/langgraph";
import { AIMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import { resolveModel, type AppConfig } from "deepagents-app-ts/runtime";

const ResearcherState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
});

type BoundModel = { invoke: (m: BaseMessage[]) => Promise<AIMessage> };

export function createResearcherSubgraph(appConfig: AppConfig, allTools: StructuredTool[]) {
  const raw = resolveModel(appConfig);
  const bound: BoundModel | null =
    raw && typeof raw !== "string"
      ? (raw as unknown as { bindTools: (t: StructuredTool[]) => BoundModel }).bindTools(allTools)
      : null;

  return new StateGraph(ResearcherState)
    .addNode("research", async (state) => {
      if (!bound) {
        return { messages: [new AIMessage({ content: "(researcher 无凭证，跳过)" })] };
      }
      const ai = await bound.invoke([
        new SystemMessage(
          "你是 researcher 子代理。用工具研究给定问题，返回结构化发现：关键事实 / 矛盾证据 / 未决问题 / 建议下一步。"
        ),
        ...state.messages,
      ]);
      return { messages: [ai] };
    })
    .addEdge(START, "research")
    .addEdge("research", END)
    .compile();
}
