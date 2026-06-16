/**
 * 示例：人审定稿（human-in-the-loop）——【拓扑：线性 + 中途 interrupt 暂停等人工】
 *
 * 对应 LangGraph 官方 how-to "Human-in-the-loop / wait for user input"
 * （interrupt + Command resume + checkpointer）。
 * 需求场景：生成内容 → 暂停让人审阅/给意见 → 按意见定稿。审批、校对、可控生成都属此类。
 *
 *   START → compose → review(interrupt 暂停) → finalize → END
 *                         ▲ 把草稿抛给用户、等回复            └ 按回复定稿
 *
 * 真实接入：compose / finalize **真调大模型**生成（无 demo fallback——未配凭证直接报错）。
 * review 用 interrupt 暂停，复用模板的 StatefulFlow seam（surface 接好 resume）。
 * ⚠️ 节点名不能与 state channel 同名：channel 有 draft，所以"写草稿"的节点叫 compose。
 */

import {
  StateGraph,
  START,
  END,
  Annotation,
  MemorySaver,
  interrupt,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { type AppConfig } from "../../src/vendor/runtime/index.js";
import type { StatefulFlow } from "../../src/surfaces/flow-types.js";
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import { requireModel, extractText, isApproval, durableCheckpointer } from "../shared.js";

const ReviewState = Annotation.Root({
  query: Annotation<string>,
  draft: Annotation<string>,
  feedback: Annotation<string>,
  output: Annotation<string>,
});
type ReviewStateType = typeof ReviewState.State;

/** compose：大模型写初稿。 */
async function composeNode(
  state: ReviewStateType,
  appConfig?: AppConfig
): Promise<Partial<ReviewStateType>> {
  const model = requireModel(appConfig, "human-in-loop 示例");
  const res = await model.invoke([
    new SystemMessage(
      "你是专业中文文案。根据用户要求写一版初稿，简洁、3–6 句，直接给正文，不要解释或寒暄。"
    ),
    new HumanMessage(state.query),
  ]);
  return { draft: extractText(res.content).trim() };
}

/**
 * review：interrupt 暂停，把草稿抛给用户审阅。
 * resume 时本节点从头重跑，interrupt 直接返回用户回复（LangGraph 语义）。
 */
function reviewNode(state: ReviewStateType): Partial<ReviewStateType> {
  const feedback = interrupt({
    question: `📝 草稿如下：\n${state.draft}\n\n请审阅：直接说修改意见，或回复「ok」通过。`,
  });
  return { feedback: String(feedback ?? "").trim() };
}

/** finalize：通过则定稿；否则大模型按意见改写。 */
async function finalizeNode(
  state: ReviewStateType,
  appConfig?: AppConfig
): Promise<Partial<ReviewStateType>> {
  const fb = (state.feedback ?? "").trim();
  if (isApproval(fb)) {
    return { output: `✅ 已通过：\n${state.draft}` };
  }
  const model = requireModel(appConfig, "human-in-loop 示例");
  const res = await model.invoke([
    new SystemMessage("根据用户的修改意见改写草稿，只输出改写后的成稿，不要解释。"),
    new HumanMessage(`原稿：\n${state.draft}\n\n修改意见：${fb}`),
  ]);
  return { output: `✏️ 已按意见修订：\n${extractText(res.content).trim()}` };
}

export function createReviewGraph(
  appConfig?: AppConfig,
  checkpointer: BaseCheckpointSaver = new MemorySaver()
) {
  return new StateGraph(ReviewState)
    .addNode("compose", (s: ReviewStateType) => composeNode(s, appConfig))
    .addNode("review", reviewNode)
    .addNode("finalize", (s: ReviewStateType) => finalizeNode(s, appConfig))
    .addEdge(START, "compose")
    .addEdge("compose", "review")
    .addEdge("review", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer });
}

/**
 * 包装成模板 StatefulFlow：run({query})→跑到 review 的 interrupt；run({resume})→finalize。
 * 经 createStatefulFlow 统一 run-loop + 持久化 resume；checkpointer 默认 FileCheckpointSaver
 * （durableCheckpointer），两次调用/重启之间草稿不丢。单测可注入 MemorySaver。
 */
export function createReviewFlow(
  appConfig?: AppConfig,
  opts: { checkpointer?: BaseCheckpointSaver } = {}
): StatefulFlow {
  return createStatefulFlow<ReviewStateType>({
    buildGraph: (cp) => createReviewGraph(appConfig, cp),
    toInput: (query) => ({ query }),
    toResult: (v) => ({ answer: v.output ?? "" }),
    checkpointer: durableCheckpointer(appConfig, opts.checkpointer),
  });
}
