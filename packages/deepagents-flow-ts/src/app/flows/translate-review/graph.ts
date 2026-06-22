/**
 * translate-review — custom 节点级拓扑（scaffold 生成的真实 TS，可手改）
 * 翻译草稿 → 人审 → 按意见定稿（节点级 custom 拓扑，重表达 human-in-loop）
 *
 * 本文件由 spec 渲染成真实 StateGraph：节点用 libs/nodes factory，prompt/route 等为内联真实代码
 * （受 tsc 检查）。改图直接改这里的 addNode / addEdge。节点 type 词表见 docs/node-catalog.md。
 */
import {
  StateGraph,
  Annotation,
  MemorySaver,
  START,
  END,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { AppConfig } from "../../../runtime/index.js";
import { createLlmNode, createHumanApprovalNode, createApprovalFinalizeNode, requireModel } from "../../../libs/nodes/index.js";
import { reflectTopology } from "../../../libs/topologies/reflect.js";
import type { FlowTopology } from "../../../core/flow-types.js";

const State = Annotation.Root({
  query: Annotation<string>(),
  draft: Annotation<string>(),
  feedback: Annotation<string>(),
  output: Annotation<string>(),
});
export type StateShape = typeof State.State;

/** 按 spec 构造图（编译后）。被 index.ts 的 recipe.buildGraph 调用。 */
export function buildGraph(appConfig: AppConfig | undefined, checkpointer: BaseCheckpointSaver = new MemorySaver()) {
  return new StateGraph(State)
    .addNode("compose", createLlmNode<StateShape>({
      model: () => requireModel(appConfig, "compose"),
      prompt: (s) => [new SystemMessage('你是专业中英互译，只输出译文，不要解释。'), new HumanMessage(s.query)],
      write: (r) => ({ draft: r.content.trim() }),
      config: appConfig,
      label: "compose",
    }))
    .addNode("review", createHumanApprovalNode<StateShape>({
      question: (s) => `译文草稿：${s.draft} —— 说修改意见，或回 ok 通过`,
      write: (feedback) => ({ feedback }),
    }))
    .addNode("finalize", createApprovalFinalizeNode<StateShape>({
      approvedOutput: (s) => ({ output: `✅ 译文已通过：${s.draft}` }),
      rejectedLlm: {
        model: () => requireModel(appConfig, "finalize"),
        prompt: (s) => [new SystemMessage('按意见改写译文，只输出成稿。'), new HumanMessage(`原译：${s.draft}；修改意见：${s.feedback}`)],
        write: (r) => ({ output: `✏️ 已按意见修订：${r.content}` }),
        config: appConfig,
        label: "finalize",
      },
    }))
    .addEdge(START, "compose")
    .addEdge("compose", "review")
    .addEdge("review", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer });
}

/** 静态拓扑反射（不运行图、不需凭证）。 */
export function getTopology(): Promise<FlowTopology> {
  return reflectTopology(buildGraph(undefined));
}
