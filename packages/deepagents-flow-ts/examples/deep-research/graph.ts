/**
 * 深度研究报告生成器 ——【长任务示例：多阶段流水线 + 多轮 HITL + 双层 reflection + 并行调研 + 持续会话】
 *
 * 这是模板里最复杂的示例，演示现有 examples 从不覆盖的"长任务编排"维度：
 *  - 多阶段流水线：选题确认 → 大纲规划 → 并行调研 → 初稿生成 → 质量评审 → 报告
 *  - 多轮 HITL：2 个一次性确认门（确认主题、确认大纲）+ 报告后的持续会话回路
 *  - 双层 reflection 循环：大纲评审重试 + 初稿质量评审重试
 *  - Send 并行扇出：每章节独立调研（Context7 文档 + DDG 网络，plan 产出 libraryHint）
 *  - **持续会话（一个会话一份研究）**：报告生成后不收场，用户可反复改/补/问，
 *    每轮复用同一份 findings + 报告上下文，直到「结束」才定稿
 *  - 复杂状态管理：大纲/章节/调研结果/初稿/报告/对话历史跨阶段累积
 *
 *   START → clarify ─(interrupt①: 确认主题)→ plan ─(interrupt②: 确认大纲)→
 *         ⟨Send 并行⟩ research × N → outline_review ─(条件边)─┐
 *                                          ▲                    ├─ 不达标 & 未达上限 → plan(带意见重规划)
 *                                          └────────────────────┘
 *                                                     └─ 达标 → write_draft → quality_review ─(条件边)─┐
 *                                                                      ▲                              ├─ 不达标 & 未达上限 → write_draft(带意见重写)
 *                                                                      └──────────────────────────────┘
 *                                            达标 → converse ⇄ respond（持续会话：interrupt 收消息 → 回应 → 再问）
 *                                                       └─(用户「结束」)→ wrapup → END
 *
 * 对应 LangGraph 官方模式组合：
 *   多轮 HITL(interrupt) + Send map-reduce + Reflection + Command 节点内路由 +
 *   research 子图(每章节 Context7 ∥ DDG 并行取优 + rateLimited 串行错峰)
 *
 * 真实接入（无 demo fallback——未配凭证直接报错）：
 *  - plan / research / draft / outline_review / quality_review / finalize **真调大模型**
 *  - research：Context7 文档 + DuckDuckGo 网络并行，启发式取优合并；DDG 限流检测 + 4.5s 闸门
 *  - onToolCall 透出每次搜索；HITL 用 interrupt 暂停。
 *
 * 长任务韧性（防一处抖动掐死整条长流水线）：
 *  - invokeLLM = 重试(指数退避) + 超时；research 搜索/整理失败降级、不崩并行分支；
 *  - outline_review / quality_review 评审解析失败时按「通过」降级放行，而非抛错终止。
 *  - 任一步真抛错时，图状态已落盘（FileCheckpointSaver）→ 用户下一句即从断点 resume 续跑，不重头来。
 *
 * ⚠️ 节点名不能与 state channel 同名（LangGraph 限制）。
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
import type { AppConfig } from "../../src/runtime/index.js";
import type { StatefulFlow } from "../../src/surfaces/flow-types.js";
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import { durableCheckpointer, emitPlan, emitStage } from "../shared.js";
import {
  clarifyNode,
  converseNode,
  deliveryNode,
  draftNode,
  fanoutToResearch,
  formatDeliveryAnswer,
  isDdgErrorText,
  isEndSignal,
  MAX_DRAFT_REVIEW,
  MAX_OUTLINE_REVIEW,
  outlineReviewNode,
  outlineToPlanEntries,
  normalizeOutlineSections,
  outlineGateNode,
  planNode,
  qualityReviewNode,
  createResearchSectionSubgraph,
  mergeResearchSources,
  scoreResearchSource,
  respondNode,
  routeAfterConverse,
  routeAfterOutlineReview,
  routeAfterQualityReview,
} from "./nodes/index.js";
import type {
  ConversationTurn,
  OutlineSection,
  ResearchFinding,
  ResearchStateShape,
} from "./nodes/types.js";

export {
  fanoutToResearch,
  createResearchSectionSubgraph,
  isDdgErrorText,
  mergeResearchSources,
  scoreResearchSource,
  isEndSignal,
  MAX_DRAFT_REVIEW,
  MAX_OUTLINE_REVIEW,
  outlineToPlanEntries,
  normalizeOutlineSections,
  routeAfterConverse,
  routeAfterOutlineReview,
  routeAfterQualityReview,
};

// ── 类型 ────────────────────────────────────────────────

// ── State ───────────────────────────────────────────────

const ResearchState = Annotation.Root({
  topic: Annotation<string>,
  refinedTopic: Annotation<string>({
    // Send 并行调研时，每个章节分支都会携带同一个 refinedTopic 进入 research 子图。
    // 父图只需要保留该主题值；显式 reducer 避免并发分支回写触发 LastValue 冲突。
    reducer: (_a, b) => b,
  }),
  outline: Annotation<OutlineSection[]>({
    // Send 扇出会把完整 outline 传给每个 research 分支，用于 ACP plan 进度展示。
    // 多个分支在同一步回写的是同一份大纲，保留最后一次即可。
    reducer: (_a, b) => b,
    default: () => [],
  }),
  currentSection: Annotation<OutlineSection>({
    // currentSection 是单个 research 子图的局部入参；父图后续不依赖它的最终值。
    // 多章节并行完成时会产生多个 currentSection 更新，使用 reducer 接住这些并发写入。
    reducer: (_a, b) => b,
  }),
  findings: Annotation<ResearchFinding[]>({
    // null 作为清空信号（planNode 重规划时重置）；Send 扇出每个分支追加单条。
    reducer: (a, b) => (b == null ? [] : [...a, ...b]),
    default: () => [],
  }),
  outlineDecision: Annotation<string>,
  outlineCritique: Annotation<string>,
  outlineAttempts: Annotation<number>,
  draftDecision: Annotation<string>,
  draftCritique: Annotation<string>,
  draftAttempts: Annotation<number>,
  draft: Annotation<string>,
  draftStreamed: Annotation<boolean>({
    reducer: (_a, b) => b,
    default: () => false,
  }),
  finalReport: Annotation<string>,
  feedback: Annotation<string>,
  // ── 报告完成后的持续会话（共享研究上下文：findings + 报告 + 对话历史）──
  /** 累积的对话轮次（并行无关，顺序追加）。 */
  conversation: Annotation<ConversationTurn[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  /** 用户最新一条后续消息（converse → respond 间传递）。 */
  userMessage: Annotation<string>,
  /** 助手最近一次回应（修订后的报告或答疑），converse 据此展示。 */
  lastAnswer: Annotation<string>,
  lastAnswerStreamed: Annotation<boolean>({
    reducer: (_a, b) => b,
    default: () => false,
  }),
  artifactMarkdownPath: Annotation<string>,
  artifactHtmlPath: Annotation<string>,
  /**
   * 用户指定的输出语言偏好（从 clarify/outlineGate 的用户回复中提取）。
   * 一旦设置不被空串覆盖，持久注入到后续所有 LLM 的 system prompt 中。
   * 与 outlineCritique 解耦：outlineReviewNode 只写 outlineCritique，不碰这个字段。
   */
  languageHint: Annotation<string>({
    reducer: (a, b) => b || a,
    default: () => "",
  }),
});
export type ResearchStateType = typeof ResearchState.State;

// ── 图组装 ──────────────────────────────────────────────

export function createResearchGraph(
  appConfig?: AppConfig,
  checkpointer: BaseCheckpointSaver = new MemorySaver()
) {
  return new StateGraph(ResearchState)
    .addNode("clarify", clarifyNode)
    .addNode("plan", async (s: ResearchStateType, c?: LangGraphRunnableConfig) => {
      await emitStage(c, {
        stage: "规划大纲",
        detail: s.outlineAttempts > 0 ? "据评审意见重规划" : undefined,
      });
      return planNode(s, appConfig, c);
    })
    .addNode("outline_gate", outlineGateNode, { ends: ["plan", "research"] })
    .addNode("research", createResearchSectionSubgraph(appConfig))
    .addNode(
      "outline_review",
      async (s: ResearchStateType, c?: LangGraphRunnableConfig) => {
        await emitStage(c, { stage: "评审调研" });
        await emitPlan(c, outlineToPlanEntries(s.outline, {
          completedTitles: s.findings.map((f) => f.title),
        }));
        return outlineReviewNode(s, appConfig);
      },
      { ends: ["plan", "write_draft"] }
    )
    .addNode("write_draft", async (s: ResearchStateType, c?: LangGraphRunnableConfig) => {
      await emitStage(c, {
        stage: "撰写初稿",
        detail: s.draftAttempts > 0 ? "据质量评审重写" : undefined,
      });
      return draftNode(s, appConfig, c);
    })
    .addNode(
      "quality_review",
      async (s: ResearchStateType, c?: LangGraphRunnableConfig) => {
        await emitStage(c, { stage: "质量评审" });
        await emitPlan(c, outlineToPlanEntries(s.outline, {
          completedTitles: s.outline.map((section) => section.title),
        }));
        return qualityReviewNode(s, appConfig);
      },
      { ends: ["write_draft", "converse"] }
    )
    .addNode("converse", converseNode, { ends: ["respond", "delivery"] })
    .addNode("respond", async (s: ResearchStateType, c?: LangGraphRunnableConfig) => {
      await emitStage(c, { stage: "回应", detail: s.userMessage.slice(0, 30) });
      return respondNode(s, appConfig, c);
    })
    .addNode("delivery", async (s: ResearchStateType, c?: LangGraphRunnableConfig) => {
      await emitStage(c, { stage: "定稿" });
      return deliveryNode(s as ResearchStateShape, appConfig, c);
    })
    .addEdge(START, "clarify")
    .addEdge("clarify", "plan")
    .addEdge("plan", "outline_gate")
    // outline_gate / outline_review / quality_review / converse 节点内 Command 路由（无静态条件边）
    .addEdge("research", "outline_review")
    .addEdge("write_draft", "quality_review")
    .addEdge("respond", "converse")
    .addEdge("delivery", END)
    .compile({ checkpointer });
}

// ── StatefulFlow 包装 ───────────────────────────────────

/**
 * 多轮 HITL + 持续会话的 StatefulFlow 封装（经 createStatefulFlow 统一基座）。
 *
 * 交互节奏：clarify(确认主题) → outline_gate(确认大纲) → 生成报告 → **converse 持续会话回路**。
 * 报告生成后不收场：用户可反复修改/补充/提问，每轮都复用同一份 findings + 报告上下文
 * （converse↔respond 循环），直到回复「结束」才 wrapup 定稿到底。
 *
 * 长任务硬化：
 *  - checkpointer 默认 FileCheckpointSaver（durableCheckpointer）→ 整段会话（含持续对话）跨进程/IDE 重启续跑；
 *  - 一个会话一个主题：首条开题、之后都续跑同一项目（hasStarted）；
 *  - configurable.appConfig 供 Send 并行的 research 实例取模型；onToolCall/onStage 由基座注入；
 *  - recursionLimit 防 reflection 回边跑飞。单测可注入 MemorySaver 保持无盘。
 */
export function createResearchFlow(
  appConfig?: AppConfig,
  opts: { checkpointer?: BaseCheckpointSaver } = {}
): StatefulFlow {
  return createStatefulFlow<ResearchStateType>({
    buildGraph: (cp) => createResearchGraph(appConfig, cp),
    toInput: (query) => ({ topic: query, outlineAttempts: 0, draftAttempts: 0, languageHint: "" }),
    toResult: (v) => ({
      answer:
        v.artifactMarkdownPath && v.artifactHtmlPath
          ? formatDeliveryAnswer({
              markdownPath: v.artifactMarkdownPath,
              htmlPath: v.artifactHtmlPath,
            })
          : v.finalReport || v.lastAnswer || v.draft || "",
    }),
    checkpointer: durableCheckpointer(appConfig, opts.checkpointer),
    configurable: { appConfig },
    recursionLimit: 50,
  });
}
