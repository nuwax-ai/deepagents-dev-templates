/**
 * human-in-loop 拓扑图 —— 线性 + 中途 interrupt 暂停等人工。
 *
 *   START → compose → present_review(MCP，可选) → review(interrupt) → finalize → END
 *                         ▲ 平台问答卡片                 ▲ checkpoint/resume       └ 按回复定稿
 *
 * 复用框架 factory（src/libs/nodes）：compose=createLlmStreamNode；review=createHumanApprovalNode；
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
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import { randomUUID } from "node:crypto";
import type { FlowCallbacks } from "../../../core/flow-types.js";
import { type AppConfig } from "../../../runtime/index.js";
import {
  createLlmStreamNode,
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

const ASK_QUESTION_TOOL_NAME = "nuwax_ask_question";
const ASK_SCHEMA_VERSION = "nuwax.mcp_ask.v2";
const ASK_UI_VERSION = "nuwax.interaction.v2";

/** 从 runtime native MCP 工具中定位 ask-question；server 前缀由 mcp-adapters 决定。 */
export function findAskQuestionTool(tools: StructuredTool[]): StructuredTool | undefined {
  return tools.find(
    (tool) =>
      tool.name === ASK_QUESTION_TOOL_NAME ||
      tool.name.endsWith(`__${ASK_QUESTION_TOOL_NAME}`)
  );
}

/**
 * 平台客户端（问答卡片提交）通常把表单格式化为“字段标签：展示值”，部分接入会回传 JSON；
 * 同时兼容两种格式与普通文本。
 * 统一抽成现有 finalize 节点理解的 "ok" / 修改意见。
 */
export function normalizeReviewFeedback(raw: string): string {
  const text = raw.trim();
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const formData =
        parsed.formData &&
        typeof parsed.formData === "object" &&
        !Array.isArray(parsed.formData)
          ? (parsed.formData as Record<string, unknown>)
          : parsed;
      const decision = String(formData.decision ?? "").trim().toLowerCase();
      const feedback = String(formData.feedback ?? "").trim();
      if (decision === "approve") return "ok";
      if (feedback) return feedback;
    } catch {
      // 非法 JSON 沿用普通文本解析。
    }
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const fieldValue = (labels: string[]): string | undefined => {
    for (const line of lines) {
      for (const label of labels) {
        const match = line.match(
          new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[：:]\\s*(.*)$`, "i")
        );
        if (match) return match[1]?.trim();
      }
    }
    return undefined;
  };
  const decision = fieldValue(["处理方式", "decision"])?.toLowerCase();
  if (decision && /^(approve|通过|通过并定稿)$/.test(decision)) return "ok";
  const feedback = fieldValue(["修改意见", "feedback"]);
  if (feedback && !/^(未填写|not provided)$/i.test(feedback)) return feedback;

  return text;
}

/**
 * 在 interrupt 前调用 ask-question MCP，在平台问答卡片中展示审阅表单。
 * 本节点单独完成后才进入 review interrupt，因此 resume 只重跑 review，不会重复发卡片。
 * MCP 缺失/失败时返回空更新，后续 plain-text interrupt 仍可用。
 */
export function createAskQuestionPresentationNode(
  askQuestionTool?: StructuredTool
): (
  state: ReviewStateType,
  config?: LangGraphRunnableConfig
) => Promise<Partial<ReviewStateType>> {
  return async (state, config) => {
    if (!askQuestionTool) return {};
    const sessionId = String(config?.configurable?.thread_id ?? "human-in-loop");
    const args = {
      schemaVersion: ASK_SCHEMA_VERSION,
      requestId: `${sessionId}:review`,
      revision: 1,
      sessionId,
      title: "审阅草稿",
      description: `请确认草稿是否通过，或填写修改意见。\n\n${state.draft}`,
      ui: {
        version: ASK_UI_VERSION,
        presentation: "inline",
        title: "审阅草稿",
        fields: [
          {
            name: "decision",
            title: "处理方式",
            widget: "radio",
            required: true,
            initialValue: "approve",
            options: [
              { value: "approve", label: "通过并定稿" },
              { value: "revise", label: "按意见修改" },
            ],
          },
          {
            name: "feedback",
            title: "修改意见",
            widget: "textarea",
            placeholder: "选择修改时填写具体意见",
          },
        ],
        submitLabel: "提交审阅",
        cancelLabel: "取消",
      },
    };
    const onToolCall = config?.configurable
      ?.onToolCall as FlowCallbacks["onToolCall"];
    const toolCallId = randomUUID();
    await onToolCall?.({
      toolCallId,
      toolName: askQuestionTool.name,
      args,
      status: "in_progress",
    });
    try {
      const result = await askQuestionTool.invoke(args, config);
      await onToolCall?.({
        toolCallId,
        toolName: askQuestionTool.name,
        args,
        status: "completed",
        result,
      });
    } catch (error) {
      await onToolCall?.({
        toolCallId,
        toolName: askQuestionTool.name,
        args,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return {};
  };
}

/**
 * 创建 review 图（编译后的 LangGraph）。
 * @param appConfig 模型/韧性配置（节点内 requireModel / resolveLlmResilience 用）
 * @param checkpointer 持久化后端（缺省 MemorySaver；生产由调用方传 FileCheckpointSaver）
 * @param systemPrompt compose 节点系统提示词（scaffold 注入；缺省领域默认）
 */
export function createReviewGraph(
  appConfig?: AppConfig,
  checkpointer: BaseCheckpointSaver = new MemorySaver(),
  systemPrompt?: string,
  askQuestionTool?: StructuredTool
) {
  // compose：框架 createLlmStreamNode（真调大模型写初稿，逐 token 流式给用户）。
  const compose = createLlmStreamNode<ReviewStateType>({
    model: () => requireModel(appConfig, "human-in-loop 拓扑"),
    prompt: (s) => [
      new SystemMessage(systemPrompt?.trim() || DEFAULT_COMPOSE_PROMPT),
      new HumanMessage(s.query),
    ],
    write: (r) => ({ draft: r.text.trim() }),
    config: appConfig,
    label: "review compose",
    timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs,
  });

  const presentReview = createAskQuestionPresentationNode(askQuestionTool);

  // review：框架 createHumanApprovalNode（interrupt 暂停把草稿抛给用户 → 写 feedback）。
  const review = createHumanApprovalNode<ReviewStateType>({
    question: (s) =>
      `📝 草稿如下：\n${s.draft}\n\n请审阅：直接说修改意见，或回复「ok」通过。`,
    write: (feedback) => ({ feedback: normalizeReviewFeedback(feedback) }),
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
      write: (r) => ({ output: `✏️ 已按意见修订：\n${r.text.trim()}` }),
      config: appConfig,
      label: "review finalize",
      timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs,
    },
  });

  return new StateGraph(ReviewState)
    .addNode("compose", compose)
    .addNode("present_review", presentReview)
    .addNode("review", review)
    .addNode("finalize", finalize)
    .addEdge(START, "compose")
    .addEdge("compose", "present_review")
    .addEdge("present_review", "review")
    .addEdge("review", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer });
}
