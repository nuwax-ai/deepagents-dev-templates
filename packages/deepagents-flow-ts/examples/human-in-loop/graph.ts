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
 * 这是模板「StatefulFlow」seam 的范例：图 interrupt 暂停后，surface（ACP/CLI）把问题发给用户、
 * 下一轮带 resume 恢复（节点从暂停点重跑，interrupt 直接返回用户回复）。
 * ⚠️ 节点名不能与 state channel 同名：channel 有 draft，所以"写草稿"的节点叫 compose。
 */

import {
  StateGraph,
  START,
  END,
  Annotation,
  MemorySaver,
  interrupt,
  Command,
} from "@langchain/langgraph";
import { logger, type AppConfig } from "deepagents-app-ts/runtime";
import type {
  StatefulFlow,
  FlowRunResult,
  FlowCallbacks,
} from "../../src/surfaces/flow-types.js";

const log = logger.child("hitl-review");

const ReviewState = Annotation.Root({
  query: Annotation<string>,
  draft: Annotation<string>,
  feedback: Annotation<string>,
  output: Annotation<string>,
});
type ReviewStateType = typeof ReviewState.State;

/** compose：生成初稿（demo 用模板；真实场景换成 LLM 节点）。 */
function composeNode(state: ReviewStateType): Partial<ReviewStateType> {
  const draft = `关于「${state.query}」的初稿：\n这是根据你的要求自动生成的第一版内容，涵盖要点 A、要点 B、要点 C。`;
  return { draft };
}

/**
 * review：interrupt 暂停，把草稿抛给用户审阅。
 * resume 时本节点**从头重跑**，interrupt 直接返回用户回复（这是 LangGraph 的语义）。
 */
function reviewNode(state: ReviewStateType): Partial<ReviewStateType> {
  const feedback = interrupt({
    question: `📝 草稿如下：\n${state.draft}\n\n请审阅：直接说修改意见，或回复「ok」通过。`,
  });
  return { feedback: String(feedback ?? "").trim() };
}

/** finalize：按用户回复定稿。ok/通过 → 用草稿；否则把意见并进去。 */
function finalizeNode(state: ReviewStateType): Partial<ReviewStateType> {
  const fb = (state.feedback ?? "").toLowerCase();
  const approved =
    !fb ||
    ["ok", "通过", "可以", "approve", "lgtm", "yes"].some((w) => fb.includes(w));
  const output = approved
    ? `✅ 已通过：\n${state.draft}`
    : `✏️ 已按意见修订：\n${state.draft}\n\n[修订说明] 应用了你的意见：${state.feedback}`;
  return { output };
}

export function createReviewGraph() {
  return new StateGraph(ReviewState)
    .addNode("compose", composeNode)
    .addNode("review", reviewNode)
    .addNode("finalize", finalizeNode)
    .addEdge(START, "compose")
    .addEdge("compose", "review")
    .addEdge("review", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer: new MemorySaver() });
}

/**
 * 把人审图包装成模板的 StatefulFlow（HITL seam）。
 * - run({query}, threadId)：起跑 → 跑到 review 的 interrupt → 返回 {interrupted, question}。
 * - run({resume}, threadId)：用同一 threadId 恢复 → finalize → 返回 {done, answer}。
 * checkpointer 据 threadId 续接状态，所以两次调用之间草稿不丢。
 */
export function createReviewFlow(_appConfig?: AppConfig): StatefulFlow {
  const graph = createReviewGraph();
  return {
    async run(input, threadId, _callbacks?: FlowCallbacks): Promise<FlowRunResult> {
      const config = { configurable: { thread_id: threadId } };
      // resume 用 Command({resume})；首跑用 partial state。
      const stream =
        input.resume !== undefined
          ? await graph.stream(new Command({ resume: input.resume }), config)
          : await graph.stream({ query: input.query ?? "" }, config);

      let interruptValue: unknown;
      for await (const chunk of stream) {
        const intr = (chunk as Record<string, unknown>).__interrupt__ as
          | Array<{ value?: unknown }>
          | undefined;
        if (intr && intr.length) interruptValue = intr[0]?.value;
      }

      if (interruptValue !== undefined) {
        const q =
          (interruptValue as { question?: string })?.question ??
          String(interruptValue);
        log.info("interrupted → 等待人审");
        return { status: "interrupted", question: q };
      }

      const snapshot = await graph.getState(config);
      const values = snapshot.values as ReviewStateType;
      return { status: "done", answer: values.output ?? "" };
    },
  };
}
