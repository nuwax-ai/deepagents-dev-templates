/**
 * human-in-loop 拓扑图 —— 线性 + 中途 interrupt 暂停等人工（自 examples/human-in-loop 提升）。
 *
 *   START → compose → review(interrupt 暂停) → finalize → END
 *                         ▲ 把草稿抛给用户、等回复            └ 按回复定稿
 *
 * 复用框架 factory（src/libs/nodes）：compose=createLlmNode；review=createHumanApprovalNode；
 * finalize=createApprovalFinalizeNode（isApproval 短路定稿 / 否则 LLM 修订）。
 *
 * systemPrompt 注入：compose 节点的系统提示词优先用传入 systemPrompt（scaffold spec 注入），
 * 缺省回退领域默认（专业中文文案）。多 LLM 节点拓扑里仅主节点接受 spec 注入，见 recipe。
 *
 * ⚠️ 节点名不能与 state channel 同名：channel 有 draft，所以「写草稿」的节点叫 compose。
 * 零 surface 依赖（仅 langgraph + runtime + libs/nodes）——可放 libs 层；createStatefulFlow
 * 包装由组合根 root / examples 各自做（recipe 在 recipe.ts）。
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
import { type AppConfig } from "../../../runtime/index.js";
import {
  createLlmNode,
  createHumanApprovalNode,
  createApprovalFinalizeNode,
  requireModel,
} from "../../nodes/index.js";
import { resolveLlmResilience } from "../../../runtime/services/llm-resilience.js";

/** compose 节点的领域默认系统提示词（spec 未注入 systemPrompt 时用）。 */
const DEFAULT_COMPOSE_PROMPT =
  "你是专业中文文案。根据用户要求写一版初稿，简洁、3–6 句，直接给正文，不要解释或寒暄。";

export const ReviewState = Annotation.Root({
  query: Annotation<string>,
  draft: Annotation<string>,
  feedback: Annotation<string>,
  output: Annotation<string>,
});
export type ReviewStateType = typeof ReviewState.State;

/**
 * 创建 review 图（编译后的 LangGraph）。
 * @param appConfig 模型/韧性配置（节点内 requireModel / resolveLlmResilience 用）
 * @param checkpointer 持久化后端（缺省 MemorySaver；生产由调用方传 FileCheckpointSaver）
 * @param systemPrompt compose 节点系统提示词（scaffold 注入；缺省领域默认）
 */
export function createReviewGraph(
  appConfig?: AppConfig,
  checkpointer: BaseCheckpointSaver = new MemorySaver(),
  systemPrompt?: string
) {
  // compose：框架 createLlmNode（真调大模型写初稿）。
  const compose = createLlmNode<ReviewStateType>({
    model: () => requireModel(appConfig, "human-in-loop 拓扑"),
    prompt: (s) => [
      new SystemMessage(systemPrompt?.trim() || DEFAULT_COMPOSE_PROMPT),
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

  // finalize：框架 createApprovalFinalizeNode（isApproval 短路定稿 / 否则 LLM 按意见修订）。
  const finalize = createApprovalFinalizeNode<ReviewStateType>({
    approvedOutput: (s) => ({ output: `✅ 已通过：\n${s.draft}` }),
    rejectedLlm: {
      model: () => requireModel(appConfig, "human-in-loop 拓扑"),
      prompt: (s) => [
        new SystemMessage("根据用户的修改意见改写草稿，只输出改写后的成稿，不要解释。"),
        new HumanMessage(`原稿：\n${s.draft}\n\n修改意见：${s.feedback}`),
      ],
      write: (r) => ({ output: `✏️ 已按意见修订：\n${r.content.trim()}` }),
      config: appConfig,
      label: "review finalize",
      timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs,
    },
  });

  return new StateGraph(ReviewState)
    .addNode("compose", compose)
    .addNode("review", review)
    .addNode("finalize", finalize)
    .addEdge(START, "compose")
    .addEdge("compose", "review")
    .addEdge("review", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer });
}
