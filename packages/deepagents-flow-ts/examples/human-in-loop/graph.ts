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
 * 节点消费框架 factory（src/libs/nodes）：
 *  - compose → createLlmNode；review → createHumanApprovalNode（interrupt + isApproval）。
 *  - finalize 保留 bespoke：含 isApproval 短路（通过则不调 LLM 直接定稿），非纯 LLM 节点。
 *
 * 真实接入：compose / finalize 的 LLM 分支 **真调大模型**（无 demo fallback——未配凭证直接报错）。
 * ⚠️ 节点名不能与 state channel 同名：channel 有 draft，所以"写草稿"的节点叫 compose。
 */

import {
  StateGraph,
  START,
  END,
  Annotation,
  MemorySaver,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { type AppConfig } from "../../src/runtime/index.js";
import type { StatefulFlow } from "../../src/surfaces/flow-types.js";
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import { requireModel } from "../shared.js";
import {
  createLlmNode,
  createHumanApprovalNode,
  isApproval,
  extractText,
} from "../../src/libs/nodes/index.js";
import { durableCheckpointer } from "../../src/runtime/services/file-checkpoint-saver.js";
import { invokeWithResilience, resolveLlmResilience } from "../../src/runtime/services/llm-resilience.js";

const ReviewState = Annotation.Root({
  query: Annotation<string>,
  draft: Annotation<string>,
  feedback: Annotation<string>,
  output: Annotation<string>,
});
type ReviewStateType = typeof ReviewState.State;

/**
 * finalize：通过则定稿；否则大模型按意见改写。
 * 保留 bespoke——isApproval 短路（通过则不调 LLM），非纯 LLM 节点，不适配 createLlmNode。
 */
async function finalizeNode(
  state: ReviewStateType,
  appConfig?: AppConfig
): Promise<Partial<ReviewStateType>> {
  const fb = (state.feedback ?? "").trim();
  if (isApproval(fb)) {
    return { output: `✅ 已通过：\n${state.draft}` };
  }
  const model = requireModel(appConfig, "human-in-loop 示例");
  const { longTimeoutMs } = resolveLlmResilience(appConfig);
  const res = await invokeWithResilience(
    model,
    [
      new SystemMessage("根据用户的修改意见改写草稿，只输出改写后的成稿，不要解释。"),
      new HumanMessage(`原稿：\n${state.draft}\n\n修改意见：${fb}`),
    ],
    { timeoutMs: longTimeoutMs, label: "review finalize", config: appConfig }
  );
  return { output: `✏️ 已按意见修订：\n${extractText(res.content).trim()}` };
}

export function createReviewGraph(
  appConfig?: AppConfig,
  checkpointer: BaseCheckpointSaver = new MemorySaver()
) {
  // compose：框架 createLlmNode（真调大模型写初稿）。
  const compose = createLlmNode<ReviewStateType>({
    model: () => requireModel(appConfig, "human-in-loop 示例"),
    prompt: (s) => [
      new SystemMessage(
        "你是专业中文文案。根据用户要求写一版初稿，简洁、3–6 句，直接给正文，不要解释或寒暄。"
      ),
      new HumanMessage(s.query),
    ],
    write: (r) => ({ draft: r.content.trim() }),
    config: appConfig,
    label: "review compose",
    timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs,
  });

  // review：框架 createHumanApprovalNode（interrupt 暂停把草稿抛给用户 → 写 feedback）。
  const review = createHumanApprovalNode<ReviewStateType>({
    question: (s) =>
      `📝 草稿如下：\n${s.draft}\n\n请审阅：直接说修改意见，或回复「ok」通过。`,
    write: (feedback) => ({ feedback }),
  });

  return new StateGraph(ReviewState)
    .addNode("compose", compose)
    .addNode("review", review)
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
    appConfig, // 自动压缩（基座在新 query 入口按阈值压 messages）
  });
}
