/**
 * 深度研究报告生成器 ——【长任务示例：多阶段流水线 + 多轮 HITL + 双层 reflection + 并行调研 + 持续会话】
 *
 * 这是模板里最复杂的示例，演示现有 examples 从不覆盖的"长任务编排"维度：
 *  - 多阶段流水线：选题确认 → 大纲规划 → 并行调研 → 初稿生成 → 质量评审 → 报告
 *  - 多轮 HITL：2 个一次性确认门（确认主题、确认大纲）+ 报告后的持续会话回路
 *  - 双层 reflection 循环：大纲评审重试 + 初稿质量评审重试
 *  - Send 并行扇出：每章节独立调研（MCP 搜索 + LLM 整理）
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
 *   多轮 HITL + Send map-reduce + Reflection/evaluator-optimizer + 条件边循环 + 持续会话回路
 *
 * 真实接入（无 demo fallback——未配凭证直接报错）：
 *  - plan / research / draft / outline_review / quality_review / finalize **真调大模型**
 *  - research 调 duckduckgo MCP（免 key 网络搜索）做真实资料搜集
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
  Send,
  MemorySaver,
  interrupt,
  type BaseCheckpointSaver,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "deepagents-app-ts/runtime";
import type { StatefulFlow, FlowCallbacks } from "../../src/surfaces/flow-types.js";
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import {
  requireModel,
  extractText,
  runTool,
  isApproval,
  durableCheckpointer,
  withTimeout,
  withRetry,
  emitStage,
} from "../shared.js";
import { callMcpTool, rateLimited, type McpServerConfig } from "../mcp-client.js";

const log = logger.child("deep-research");

// ── 常量 ────────────────────────────────────────────────

/** 大纲评审重试上限（防 reflection 死循环）。 */
export const MAX_OUTLINE_REVIEW = 2;
/** 初稿质量评审重试上限。 */
export const MAX_DRAFT_REVIEW = 2;
/** 单次 research 节点的 MCP 搜索超时。 */
const SEARCH_TIMEOUT_MS = 20000;
/** 短 LLM 调用超时（plan / review / 摘要：输出短，60s 足够）。 */
const LLM_TIMEOUT_MS = 60000;
/** 长 LLM 调用超时（write_draft / respond：800-2000 字生成，慢模型可能超 60s）。 */
const LLM_LONG_TIMEOUT_MS = 180000;

/** 网络搜索 MCP（duckduckgo-mcp-server，免 key；与 travel-planner 同源）。
 *  注：早期版本误用 context7（仅库文档检索、无通用 search 工具）→ 每次搜索 -32602 失败。 */
const SEARCH_MCP: McpServerConfig = {
  command: "npx",
  args: ["-y", "duckduckgo-mcp-server"],
};

// ── 类型 ────────────────────────────────────────────────

interface OutlineSection {
  title: string;
  query: string;
}

interface ResearchFinding {
  title: string;
  searchResult: string;
  summary: string;
}

/** 报告完成后的持续会话的一轮（用户问/助手答，共享同一研究上下文）。 */
interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

// ── State ───────────────────────────────────────────────

const ResearchState = Annotation.Root({
  topic: Annotation<string>,
  refinedTopic: Annotation<string>,
  outline: Annotation<OutlineSection[]>,
  currentSection: Annotation<OutlineSection>,
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

// ── 工具函数 ────────────────────────────────────────────

/**
 * 从用户自由文本中提取语言偏好指令（"用中文" → "请以中文输出"）。无明确偏好返回 ""。
 * 捕获后存入 languageHint 字段，持久注入到后续所有 LLM system prompt，不依赖 outlineCritique。
 */
function extractLanguageHint(text: string): string {
  if (/用?中文|chinese/i.test(text)) return "请以中文输出";
  if (/用?英文|english/i.test(text)) return "Please output in English";
  if (/用?日(语|文)|japanese/i.test(text)) return "日本語で出力してください";
  if (/용?한국어|korean/i.test(text)) return "한국어로 출력해 주세요";
  return "";
}

/** 生成追加在 SystemMessage 末尾的语言要求子句（空字符串表示无偏好）。 */
function langClause(hint: string): string {
  return hint ? `\n\n**语言要求：${hint}**` : "";
}

/**
 * 从 LLM 文本里抽出第一段 JSON（容忍 ```json 围栏与前后说明文字）。
 */
function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error(`LLM 未返回 JSON：${text.slice(0, 200)}`);
  const close = cleaned[start] === "[" ? "]" : "}";
  const end = cleaned.lastIndexOf(close);
  if (end <= start) throw new Error(`LLM JSON 不完整：${text.slice(0, 200)}`);
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

/** 调模型 + 超时护栏 + 重试（限流/抖动/挂死都不直接掐死长流水线；重试用尽才抛）。 */
type LLMLike = { invoke: (messages: BaseMessage[]) => Promise<{ content: unknown }> };
function invokeLLM(
  m: LLMLike,
  messages: BaseMessage[],
  timeoutMs = LLM_TIMEOUT_MS
): Promise<{ content: unknown }> {
  return withRetry(
    () => withTimeout(m.invoke(messages), timeoutMs, "deep-research 调模型"),
    { attempts: 3, baseDelayMs: 1000, label: "deep-research LLM" }
  );
}

// ── 节点 ────────────────────────────────────────────────

/**
 * clarify：interrupt① — 与用户确认/调整研究主题。
 * 把原始 topic 抛给用户，等回复后写入 refinedTopic。
 */
function clarifyNode(state: ResearchStateType): Partial<ResearchStateType> {
  const feedback = interrupt({
    question:
      `🔬 研究主题：「${state.topic}」\n\n` +
      `确认研究这个主题，或提供更具体的方向（如：聚焦某个技术栈、某个场景、某个对比维度）。\n` +
      `直接回复「ok」确认，或输入你的调整。`,
  });
  const fb = String(feedback ?? "").trim();
  const languageHint = extractLanguageHint(fb);
  return {
    refinedTopic: fb && !isApproval(fb) ? `${state.topic}（方向：${fb}）` : state.topic,
    ...(languageHint ? { languageHint } : {}),
  };
}

/**
 * plan：LLM 生成研究大纲（3-5 个章节，每章节含标题+检索关键词）。
 * 重规划轮把上一轮大纲评审意见喂回去改进。
 */
async function planNode(
  state: ResearchStateType,
  appConfig?: AppConfig
): Promise<Partial<ResearchStateType>> {
  const model = requireModel(appConfig, "deep-research 示例");
  const isReplan = state.outlineAttempts > 0 && Boolean(state.outlineCritique);
  const res = await invokeLLM(model, [
    new SystemMessage(
      `你是资深研究分析师。为给定主题制定一份研究报告大纲，包含 3-5 个章节（Section）。` +
        `每章节含 title（标题）和 query（用于文档检索的关键词，英文优先）。` +
        `只输出 JSON 数组：[{"title":"...","query":"..."}]，不要解释。` +
        (isReplan ? `\n上一轮评审意见（据此改进大纲）：${state.outlineCritique}` : "") +
        langClause(state.languageHint)
    ),
    new HumanMessage(`研究主题：${state.refinedTopic}`),
  ]);
  const sections = parseJson<OutlineSection[]>(extractText(res.content));
  log.info("plan", {
    sections: sections.length,
    attempt: state.outlineAttempts + 1,
    isReplan,
  });
  // 用户主导的大纲修订不消耗 LLM 评审重试配额；null 触发 findings reducer 的清空逻辑。
  const isUserRevise = state.outlineDecision === "user_revise";
  return {
    outline: sections,
    findings: null as unknown as ResearchFinding[],
    outlineAttempts: isUserRevise ? state.outlineAttempts : state.outlineAttempts + 1,
  };
}

/**
 * outlineGate：interrupt② — 把大纲抛给用户确认。
 */
function outlineGateNode(state: ResearchStateType): Partial<ResearchStateType> {
  const list = state.outline
    .map((s, i) => `${i + 1}. ${s.title}（搜索：${s.query}）`)
    .join("\n");
  const feedback = interrupt({
    question:
      `📋 研究大纲（${state.refinedTopic}）：\n${list}\n\n` +
      `确认大纲开始调研，或回复调整意见。\n直接回复「ok」确认。`,
  });
  const fb = String(feedback ?? "").trim();
  const languageHint = extractLanguageHint(fb);
  if (fb && !isApproval(fb)) {
    return {
      outlineCritique: fb,
      outlineDecision: "user_revise",
      ...(languageHint ? { languageHint } : {}),
    };
  }
  return {
    outlineDecision: "ok",
    ...(languageHint ? { languageHint } : {}),
  };
}

/**
 * fanoutToResearch：条件边函数 — 为每个 outline section 派一个 research 实例（Send 扇出）。
 * 导出供单测。
 */
export function fanoutToResearch(state: ResearchStateType): Send[] {
  return state.outline.map(
    (section) =>
      new Send("research", {
        currentSection: section,
        refinedTopic: state.refinedTopic,
        languageHint: state.languageHint,
      })
  );
}

/**
 * research：对单个 section 发一次 duckduckgo 网络搜索（rateLimited 节流），
 * 然后 LLM 把搜索结果整理成结构化摘要。
 *
 * 韧性：搜索失败 → 降级为「基于常识整理」；整理失败（重试用尽）→ 退回截断的原始素材，
 * **绝不抛错**——并行分支之一挂掉不该让整个 Send 扇出（进而整条长任务）崩。
 */
async function researchNode(
  state: ResearchStateType,
  config?: LangGraphRunnableConfig
): Promise<Partial<ResearchStateType>> {
  const onToolCall = config?.configurable?.onToolCall as
    | FlowCallbacks["onToolCall"]
    | undefined;
  const section = state.currentSection;
  const query = section.query;
  await emitStage(config, { stage: "调研", detail: section.title });

  const { result: searchResult, ok } = await runTool(
    "duckduckgo_search",
    { query },
    () =>
      rateLimited(
        () => callMcpTool(SEARCH_MCP, "duckduckgo_search", { query, count: 5 }, SEARCH_TIMEOUT_MS)
      ),
    onToolCall
  );

  const rawMaterial = ok
    ? searchResult.slice(0, 1200)
    : `（搜索失败：${searchResult}，将基于主题常识整理）`;

  const model = requireModel(
    config?.configurable?.appConfig as AppConfig,
    "deep-research 示例"
  );
  let summary: string;
  try {
    const res = await invokeLLM(model, [
      new SystemMessage(
        `你是技术分析师。根据检索资料，为章节「${section.title}」写一段 200-400 字的结构化摘要。` +
          `提取关键事实、数据、结论，不要堆砌链接。只输出摘要正文。` +
          langClause(state.languageHint)
      ),
      new HumanMessage(
        `主题：${state.refinedTopic}\n章节：${section.title}\n检索关键词：${query}\n检索资料：\n${rawMaterial}`
      ),
    ]);
    summary = extractText(res.content).trim();
  } catch (err) {
    // 整理失败也不崩并行分支：有搜索结果则截断原文，否则写明该章节获取失败（避免错误信息污染 findings）。
    log.warn("research 整理失败 → 降级", { section: section.title, error: String(err) });
    summary = ok ? rawMaterial.slice(0, 400) : `（${section.title} 资料获取失败，该章节将基于其他已有内容推断）`;
  }
  log.info("research done", { section: section.title, summaryLen: summary.length });
  return {
    findings: [{ title: section.title, searchResult: rawMaterial, summary }],
  };
}

/**
 * outline_review：LLM 评审并行调研结果的质量。
 * 判断是否充分覆盖了大纲，不充分则带评审意见回 plan 重规划。
 */
async function outlineReviewNode(
  state: ResearchStateType,
  appConfig?: AppConfig
): Promise<Partial<ResearchStateType>> {
  const model = requireModel(appConfig, "deep-research 示例");
  const findingsSummary = state.findings
    .map((f) => `## ${f.title}\n${f.summary.slice(0, 200)}...`)
    .join("\n\n");
  try {
    const res = await invokeLLM(model, [
      new SystemMessage(
        `你是研究评审。判断调研结果是否充分覆盖了大纲的所有章节、每章是否有实质内容。` +
          `只输出 JSON：{"verdict":"sufficient"|"insufficient","critique":"一句话说明缺什么，或为何可通过"}。`
      ),
      new HumanMessage(
        `主题：${state.refinedTopic}\n大纲章节：${state.outline.map((s) => s.title).join("、")}\n\n调研摘要：\n${findingsSummary}`
      ),
    ]);
    const v = parseJson<{ verdict?: string; critique?: string }>(extractText(res.content));
    const decision = v.verdict === "insufficient" ? "insufficient" : "sufficient";
    log.info("outline_review", { decision, findings: state.findings.length });
    return { outlineDecision: decision, outlineCritique: v.critique ?? "" };
  } catch (err) {
    // 评审失败（重试用尽/JSON 解析不出）→ 按「通过」降级放行，让长任务继续推进而非崩
    log.warn("outline_review 失败 → 按 sufficient 放行", { error: String(err) });
    return { outlineDecision: "sufficient", outlineCritique: "(评审异常，已放行)" };
  }
}

/**
 * 条件边（纯函数）：大纲评审不达标 & 未达上限 → 回 plan；否则 → draft。
 * 导出供单测。
 */
export function routeAfterOutlineReview(state: ResearchStateType): "plan" | "write_draft" {
  if (
    state.outlineDecision === "insufficient" &&
    state.outlineAttempts < MAX_OUTLINE_REVIEW
  ) {
    return "plan";
  }
  return "write_draft";
}

/**
 * draft：LLM 基于全部调研结果生成报告初稿。
 * 重写轮把质量评审意见喂回去改进。
 */
async function draftNode(
  state: ResearchStateType,
  appConfig?: AppConfig
): Promise<Partial<ResearchStateType>> {
  const model = requireModel(appConfig, "deep-research 示例");
  const isRewrite = state.draftAttempts > 0 && Boolean(state.draftCritique);
  const material = state.findings
    .map((f) => `## ${f.title}\n${f.summary}`)
    .join("\n\n---\n\n");
  let draft: string;
  try {
    const res = await invokeLLM(model, [
      new SystemMessage(
        `你是资深技术写作专家。根据调研资料，为「${state.refinedTopic}」撰写一份结构清晰、逻辑连贯的研究报告。` +
          `报告应包含引言、各章节分析、结论与建议。Markdown 格式，800-2000 字。不要堆砌链接，聚焦洞察。` +
          (isRewrite ? `\n质量评审意见（据此改进）：${state.draftCritique}` : "") +
          langClause(state.languageHint)
      ),
      new HumanMessage(`调研资料：\n${material}`),
    ], LLM_LONG_TIMEOUT_MS);
    draft = extractText(res.content).trim();
  } catch (err) {
    // 重试耗尽也不崩图：复用上一版草稿（若有），并触发质量评审降级放行，让用户介入。
    log.warn("draft 生成失败 → 复用上一版草稿", { attempt: state.draftAttempts + 1, error: String(err) });
    draft = state.draft || material.slice(0, 2000);
  }
  log.info("draft", { length: draft.length, attempt: state.draftAttempts + 1, isRewrite });
  return { draft, draftAttempts: state.draftAttempts + 1 };
}

/**
 * quality_review：LLM 评审报告质量。
 * 不达标则带意见回 draft 重写。
 */
async function qualityReviewNode(
  state: ResearchStateType,
  appConfig?: AppConfig
): Promise<Partial<ResearchStateType>> {
  const model = requireModel(appConfig, "deep-research 示例");
  try {
    const res = await invokeLLM(model, [
      new SystemMessage(
        `你是报告质量评审。判断报告是否：结构完整、论据充分、逻辑连贯、无明显遗漏。` +
          `只输出 JSON：{"verdict":"pass"|"fail","critique":"一句话说明问题，或为何通过"}。`
      ),
      new HumanMessage(
        `主题：${state.refinedTopic}\n报告（前 2000 字）：\n${state.draft.slice(0, 2000)}`
      ),
    ]);
    const v = parseJson<{ verdict?: string; critique?: string }>(extractText(res.content));
    const decision = v.verdict === "fail" ? "fail" : "pass";
    log.info("quality_review", { decision, attempt: state.draftAttempts });
    return { draftDecision: decision, draftCritique: v.critique ?? "" };
  } catch (err) {
    // 评审失败 → 按「通过」降级放行（已有初稿，进 approve 让用户定夺），不崩长任务
    log.warn("quality_review 失败 → 按 pass 放行", { error: String(err) });
    return { draftDecision: "pass", draftCritique: "(评审异常，已放行)" };
  }
}

/**
 * 条件边（纯函数）：质量评审不达标 & 未达上限 → 回 draft；否则 → approve。
 * 导出供单测。
 */
export function routeAfterQualityReview(state: ResearchStateType): "write_draft" | "approve" {
  if (
    state.draftDecision === "fail" &&
    state.draftAttempts < MAX_DRAFT_REVIEW
  ) {
    return "write_draft";
  }
  return "approve";
}

/** 收尾信号：空 / 通过类词 / 明确「结束」类词 → 结束持续会话、定稿。 */
const END_RE = /^(结束|完成|done|搞定|收工|没了|不用了|就这样)$/i;
export function isEndSignal(msg: string): boolean {
  return isApproval(msg) || END_RE.test(msg.trim());
}

/**
 * converse：interrupt —— 报告完成后进入【持续会话】。
 * 展示当前报告（首轮）或上一轮回应（后续轮），收集用户下一条消息。
 * 一个会话一份研究：用户可反复修改/补充/提问，始终复用同一份 findings + 报告上下文。
 */
function converseNode(state: ResearchStateType): Partial<ResearchStateType> {
  const isFirst = state.conversation.length === 0;
  const current = state.lastAnswer || state.finalReport || state.draft;
  const feedback = interrupt({
    question: isFirst
      ? `📄 研究报告（${state.refinedTopic}）：\n\n${current}\n\n---\n` +
        `报告已生成。可就这份研究继续：要改哪段、补充什么、或直接提问；回复「结束」收尾定稿。`
      : `${current}\n\n---\n还需要什么？（继续修改/提问，或回复「结束」收尾）`,
  });
  const msg = String(feedback ?? "").trim();
  return { userMessage: msg, conversation: [{ role: "user", content: msg }] };
}

/** 路由（纯函数，导出供单测）：用户收尾 → wrapup 定稿；否则 → respond 持续会话。 */
export function routeAfterConverse(state: ResearchStateType): "respond" | "wrapup" {
  return isEndSignal(state.userMessage) ? "wrapup" : "respond";
}

/**
 * respond：用累积的研究上下文（findings + 当前报告 + 对话历史）回应用户最新消息。
 * 修改/补充类 → 输出修订后的完整报告（更新 finalReport）；提问类 → 直接作答。结果进会话历史。
 */
async function respondNode(
  state: ResearchStateType,
  appConfig?: AppConfig
): Promise<Partial<ResearchStateType>> {
  const model = requireModel(appConfig, "deep-research 示例");
  const findingsSummary = state.findings
    .map((f) => `## ${f.title}\n${f.summary}`)
    .join("\n\n");
  // converseNode 已把当前用户消息追加进 conversation，而 prompt 末尾会单独放 userMessage，
  // 排除最后一条（当前轮用户消息）避免在 prompt 里重复出现。
  const convo = state.conversation
    .slice(0, -1)
    .slice(-6)
    .map((t) => `${t.role === "user" ? "用户" : "助手"}：${t.content}`)
    .join("\n");
  const current = state.finalReport || state.draft;
  const res = await invokeLLM(model, [
    new SystemMessage(
      `你在就一份研究报告与用户持续对话。依据【研究资料】与【当前报告】回应用户最新消息：\n` +
        `- 若要求修改/补充报告 → 输出修订后的【完整报告】（Markdown，保持原结构与语境）；\n` +
        `- 若是提问 → 直接简洁作答，不必重发报告。\n只输出正文。` +
        langClause(state.languageHint)
    ),
    new HumanMessage(
      `主题：${state.refinedTopic}\n\n【研究资料】\n${findingsSummary}\n\n【当前报告】\n${current}\n\n【对话】\n${convo}\n\n用户最新消息：${state.userMessage}`
    ),
  ], LLM_LONG_TIMEOUT_MS);
  const answer = extractText(res.content).trim();
  // 看起来像完整报告（够长 + 有 Markdown 标题）→ 视为修订，更新 finalReport
  const looksLikeReport = answer.length > 800 && /(^|\n)#{1,3}\s/.test(answer);
  log.info("respond", { revised: looksLikeReport, answerLen: answer.length });
  return {
    ...(looksLikeReport ? { finalReport: answer } : {}),
    lastAnswer: answer,
    conversation: [{ role: "assistant", content: answer }],
  };
}

/** wrapup：用户收尾 —— 定稿为当前报告（lastAnswer 优先：短修订只落 lastAnswer；再取 finalReport；最后 draft）。 */
function wrapupNode(state: ResearchStateType): Partial<ResearchStateType> {
  return { finalReport: state.lastAnswer || state.finalReport || state.draft };
}

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
      return planNode(s, appConfig);
    })
    .addNode("outline_gate", outlineGateNode)
    .addNode("research", (s: ResearchStateType, c?: LangGraphRunnableConfig) =>
      researchNode(s, c)
    )
    .addNode("outline_review", async (s: ResearchStateType, c?: LangGraphRunnableConfig) => {
      await emitStage(c, { stage: "评审调研" });
      return outlineReviewNode(s, appConfig);
    })
    .addNode("write_draft", async (s: ResearchStateType, c?: LangGraphRunnableConfig) => {
      await emitStage(c, {
        stage: "撰写初稿",
        detail: s.draftAttempts > 0 ? "据质量评审重写" : undefined,
      });
      return draftNode(s, appConfig);
    })
    .addNode("quality_review", async (s: ResearchStateType, c?: LangGraphRunnableConfig) => {
      await emitStage(c, { stage: "质量评审" });
      return qualityReviewNode(s, appConfig);
    })
    .addNode("converse", converseNode)
    .addNode("respond", async (s: ResearchStateType, c?: LangGraphRunnableConfig) => {
      await emitStage(c, { stage: "回应", detail: s.userMessage.slice(0, 30) });
      return respondNode(s, appConfig);
    })
    .addNode("wrapup", async (s: ResearchStateType, c?: LangGraphRunnableConfig) => {
      await emitStage(c, { stage: "定稿" });
      return wrapupNode(s);
    })
    .addEdge(START, "clarify")
    .addEdge("clarify", "plan")
    .addEdge("plan", "outline_gate")
    .addConditionalEdges("outline_gate", (state: ResearchStateType) => {
      // 用户要改大纲 → 回 plan；确认 → 并行 research 扇出
      if (state.outlineDecision === "user_revise") return "plan";
      return fanoutToResearch(state);
    })
    .addEdge("research", "outline_review")
    .addConditionalEdges("outline_review", routeAfterOutlineReview, {
      plan: "plan",
      write_draft: "write_draft",
    })
    .addEdge("write_draft", "quality_review")
    .addConditionalEdges("quality_review", routeAfterQualityReview, {
      write_draft: "write_draft",
      approve: "converse", // 质量通过 → 进入持续会话
    })
    // 持续会话回路：converse(interrupt 收消息) → respond(回应) → converse … 直到用户收尾
    .addConditionalEdges("converse", routeAfterConverse, {
      respond: "respond",
      wrapup: "wrapup",
    })
    .addEdge("respond", "converse")
    .addEdge("wrapup", END)
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
    toResult: (v) => ({ answer: v.finalReport || v.lastAnswer || v.draft || "" }),
    checkpointer: durableCheckpointer(appConfig, opts.checkpointer),
    configurable: { appConfig },
    recursionLimit: 50,
  });
}
