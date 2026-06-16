/** 选题确认与大纲规划节点。 */

import { Command, interrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { fanoutToResearch } from "./research.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { AppConfig } from "../../../src/runtime/index.js";
import { extractText, emitPlan, isApproval, requireModel } from "../../shared.js";
import type { OutlineSection, ResearchFinding, ResearchStateShape } from "./types.js";
import { extractLanguageHint, invokeLLM, langClause, parseJson } from "./helpers.js";

/**
 * clarify：interrupt① — 与用户确认/调整研究主题。
 * 把原始 topic 抛给用户，等回复后写入 refinedTopic。
 */
export function clarifyNode(state: ResearchStateShape): Partial<ResearchStateShape> {
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

/** 大纲 → ACP Plan entries；可按当前章节/已完成章节标记状态。 */
export function outlineToPlanEntries(
  outline: OutlineSection[],
  opts: { currentTitle?: string; completedTitles?: string[] } = {}
) {
  const completed = new Set(opts.completedTitles ?? []);
  return outline.map((section) => ({
    content: `${section.title}（搜索：${section.query}）`,
    priority: "medium" as const,
    status: completed.has(section.title)
      ? ("completed" as const)
      : section.title === opts.currentTitle
        ? ("in_progress" as const)
        : ("pending" as const),
  }));
}

/**
 * plan：LLM 生成研究大纲（3-5 个章节，每章节含标题+检索关键词）。
 * 重规划轮把上一轮大纲评审意见喂回去改进。
 */
export async function planNode(
  state: ResearchStateShape,
  appConfig?: AppConfig,
  config?: LangGraphRunnableConfig
): Promise<Partial<ResearchStateShape>> {
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
  ], appConfig);
  const sections = parseJson<OutlineSection[]>(extractText(res.content));
  await emitPlan(config, outlineToPlanEntries(sections));
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
export function outlineGateNode(state: ResearchStateShape): Partial<ResearchStateShape> {
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
