/**
 * interview-agent — custom 节点级拓扑（scaffold 生成的真实 TS，可手改）
 * 面试官 Agent：JD+简历 → 连环技术追问(HITL) → 能力评估报告（custom + interrupt 范例；prepare 无 parse）
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
import { createLlmNode, createHumanApprovalNode, requireModel, parseJson } from "../../../libs/nodes/index.js";
import { reflectTopology } from "../../../libs/topologies/reflect.js";
import type { FlowTopology } from "../../../core/flow-types.js";

const State = Annotation.Root({
  query: Annotation<string>(),
  scores: Annotation<unknown[]>({ reducer: (a, b) => [...(a ?? []), ...(b ?? [])], default: () => [] }),
  questionHistory: Annotation<unknown[]>({ reducer: (a, b) => [...(a ?? []), ...(b ?? [])], default: () => [] }),
  currentQuestion: Annotation<string>(),
  userAnswer: Annotation<string>(),
  currentFeedback: Annotation<string>(),
  questionCount: Annotation<number>(),
  phase: Annotation<string>(),
  report: Annotation<string>(),
});
export type StateShape = typeof State.State;

/** 按 spec 构造图（编译后）。被 index.ts 的 recipe.buildGraph 调用。 */
export function buildGraph(appConfig: AppConfig | undefined, checkpointer: BaseCheckpointSaver = new MemorySaver()) {
  return new StateGraph(State)
    .addNode("prepare", createLlmNode<StateShape>({
      model: () => requireModel(appConfig, "prepare"),
      prompt: (s) => [new SystemMessage('你是资深技术面试官。如果用户输入的是岗位描述和简历，请分析并制定面试策略。如果用户只是打招呼或问其他问题，请友好地自我介绍并引导用户提供岗位描述和简历。输出先与用户对话，不需要 JSON 格式。'), new HumanMessage(s.query)],
      write: (_r) => ({ phase: 'questioning' }),
      config: appConfig,
      label: "prepare",
    }))
    .addNode("ask", createLlmNode<StateShape>({
      model: () => requireModel(appConfig, "ask"),
      prompt: (s) => {
  const historyText = (s.questionHistory ?? []).length > 0 ? '\n已完成的问答：\n' + (s.questionHistory ?? []).join('\n---\n') : '\n开始第一轮提问。';
  return [new SystemMessage('你是技术面试官。基于面试策略、已回答的问题，提出下一个技术面试问题。必须遵守以下要求：\n1. 从基础到深入层层递进\n2. 如果上一回答有误则追问相关基础概念\n3. 如果回答正确则提升难度或换新领域\n4. 只输出问题本身，不要序号和评价\n5. 问题要具体且有深度，不要泛泛而问'), new HumanMessage(`面试背景（岗位描述+简历）：${s.query}\n${historyText}\n\n当前是第${(s.questionCount ?? 0) + 1}个问题。请提出下一个技术面试问题。`)];
},
      write: (r, s) => ({ currentQuestion: r.content, questionCount: (s.questionCount ?? 0) + 1 }),
      config: appConfig,
      label: "ask",
    }))
    .addNode("wait", createHumanApprovalNode<StateShape>({
      question: (s) => `## 面试官提问（第${s.questionCount}题）\n\n${s.currentQuestion}`,
      write: (feedback) => ({ userAnswer: String(feedback ?? '') }),
    }))
    .addNode("evaluate", createLlmNode<StateShape>({
      model: () => requireModel(appConfig, "evaluate"),
      prompt: (s) => [new SystemMessage('你是面试评分专家。评估候选人的回答，输出 JSON 格式：{"score":<1-10>,"feedback":"具体反馈","correctAnswer":"正确答案（回答不完整或错误时提供）","shouldContinue":true}。评分标准：8-10=优秀，5-7=合格但有改进空间，1-4=需要加强。必须提供有建设性的反馈。'), new HumanMessage(`问题：${s.currentQuestion}\n\n候选人的回答：${s.userAnswer}`)],
      write: (r, s) => {
  const p = (r.parsed ?? {}) as Record<string, unknown>;
  const score = String(p.score ?? 5);
  const feedback = String(p.feedback ?? '');
  const correctAnswer = String(p.correctAnswer ?? '');
  const shouldContinue = p.shouldContinue !== false;
  const entry = `【第${s.questionCount}题】得分：${score}/10\n反馈：${feedback}${correctAnswer ? '\n参考答案：' + correctAnswer : ''}`;
  return {
    scores: [score],
    questionHistory: [entry],
    currentFeedback: `**评分**：${score}/10\n\n${feedback}${correctAnswer ? '\n\n**参考答案**：' + correctAnswer : ''}`,
    phase: (!shouldContinue || (s.questionCount ?? 0) >= 8) ? 'complete' : 'questioning'
  };
},
      parse: (t) => parseJson(t),
      config: appConfig,
      label: "evaluate",
    }))
    .addNode("writeReport", createLlmNode<StateShape>({
      model: () => requireModel(appConfig, "writeReport"),
      prompt: (s) => {
  const scores = (s.scores ?? []).join(', ');
  const history = (s.questionHistory ?? []).join('\n---\n');
  return [new SystemMessage('你基于面试记录生成详细的能力评估报告。报告必须包括以下结构：\n### 1. 面试概览\n- 考察领域、问题数量、整体表现\n### 2. 各领域能力评分（表格）\n### 3. 优势与待改进项\n### 4. 综合评级：A(卓越)/B(良好)/C(一般)/D(待加强)\n### 5. 录用建议与后续面试建议\n### 6. 技术深度与广度评估'), new HumanMessage(`岗位描述与简历：${s.query}\n\n各题得分：${scores}\n\n面试记录：\n${history}`)];
},
      write: (r, _s) => ({ report: r.content, phase: 'complete' }),
      config: appConfig,
      label: "writeReport",
    }))
    .addEdge(START, "prepare")
    .addEdge("prepare", "ask")
    .addEdge("ask", "wait")
    .addEdge("wait", "evaluate")
    .addConditionalEdges("evaluate", (s) => (s.phase === 'complete' || (s.questionCount ?? 0) >= 8) ? 'writeReport' : 'ask', { "ask": "ask", "writeReport": "writeReport" })
    .addEdge("writeReport", END)
    .compile({ checkpointer });
}

/** 静态拓扑反射（不运行图、不需凭证）。 */
export function getTopology(): Promise<FlowTopology> {
  return reflectTopology(buildGraph(undefined));
}
