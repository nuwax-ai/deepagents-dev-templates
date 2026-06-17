/** 大纲与报告质量评审节点。 */

import { Command } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "../../../src/runtime/index.js";
import { requireModel } from "../../shared.js";
import { extractText, parseJson } from "../../../src/libs/nodes/index.js";
import type { ResearchStateShape } from "./types.js";
import { invokeLLM } from "./helpers.js";

const log = logger.child("deep-research");

/** 大纲评审重试上限（防 reflection 死循环）。 */
export const MAX_OUTLINE_REVIEW = 2;
/** 初稿质量评审重试上限。 */
export const MAX_DRAFT_REVIEW = 2;

/**
 * outline_review：LLM 评审并行调研结果的质量。
 * 判断是否充分覆盖了大纲，不充分则带评审意见回 plan 重规划。
 */
export async function outlineReviewNode(
  state: ResearchStateShape,
  appConfig?: AppConfig
): Promise<Command> {
  const model = requireModel(appConfig, "deep-research 示例");
  const findingsSummary = state.findings
    .map((f) => `## ${f.title}\n${f.summary.slice(0, 200)}...`)
    .join("\n\n");
  let update: Partial<ResearchStateShape>;
  try {
    const res = await invokeLLM(model, [
      new SystemMessage(
        `你是研究评审。判断调研结果是否充分覆盖了大纲的所有章节、每章是否有实质内容。` +
          `只输出 JSON：{"verdict":"sufficient"|"insufficient","critique":"一句话说明缺什么，或为何可通过"}。`
      ),
      new HumanMessage(
        `主题：${state.refinedTopic}\n大纲章节：${state.outline.map((s) => s.title).join("、")}\n\n调研摘要：\n${findingsSummary}`
      ),
    ], appConfig);
    const v = parseJson<{ verdict?: string; critique?: string }>(extractText(res.content));
    const decision = v.verdict === "insufficient" ? "insufficient" : "sufficient";
    log.info("outline_review", { decision, findings: state.findings.length });
    update = { outlineDecision: decision, outlineCritique: v.critique ?? "" };
  } catch (err) {
    log.warn("outline_review 失败 → 按 sufficient 放行", { error: String(err) });
    update = { outlineDecision: "sufficient", outlineCritique: "(评审异常，已放行)" };
  }
  const goto = routeAfterOutlineReview({ ...state, ...update });
  return new Command({ goto, update });
}

/**
 * 条件边（纯函数）：大纲评审不达标 & 未达上限 → 回 plan；否则 → draft。
 */
export function routeAfterOutlineReview(state: ResearchStateShape): "plan" | "write_draft" {
  if (
    state.outlineDecision === "insufficient" &&
    state.outlineAttempts < MAX_OUTLINE_REVIEW
  ) {
    return "plan";
  }
  return "write_draft";
}

/**
 * quality_review：LLM 评审报告质量。
 * 不达标则带意见回 draft 重写。
 */
export async function qualityReviewNode(
  state: ResearchStateShape,
  appConfig?: AppConfig
): Promise<Command> {
  const model = requireModel(appConfig, "deep-research 示例");
  let update: Partial<ResearchStateShape>;
  try {
    const res = await invokeLLM(model, [
      new SystemMessage(
        `你是报告质量评审。判断报告是否：结构完整、论据充分、逻辑连贯、无明显遗漏。` +
          `只输出 JSON：{"verdict":"pass"|"fail","critique":"一句话说明问题，或为何通过"}。`
      ),
      new HumanMessage(
        `主题：${state.refinedTopic}\n报告（前 2000 字）：\n${state.draft.slice(0, 2000)}`
      ),
    ], appConfig);
    const v = parseJson<{ verdict?: string; critique?: string }>(extractText(res.content));
    const decision = v.verdict === "fail" ? "fail" : "pass";
    log.info("quality_review", { decision, attempt: state.draftAttempts, apiOk: true });
    update = { draftDecision: decision, draftCritique: v.critique ?? "" };
  } catch (err) {
    log.warn("quality_review API 失败 → 按 pass 放行", { error: String(err), apiOk: false });
    update = { draftDecision: "pass", draftCritique: "(评审异常，已放行)" };
  }
  const goto = routeAfterQualityReview({ ...state, ...update });
  return new Command({ goto, update });
}

/**
 * 条件边（纯函数）：质量评审不达标 & 未达上限 → 回 draft；否则 → converse（进入持续会话）。
 * 返回值与图节点 ends（["write_draft","converse"]）对齐。
 */
export function routeAfterQualityReview(state: ResearchStateShape): "write_draft" | "converse" {
  if (
    state.draftDecision === "fail" &&
    state.draftAttempts < MAX_DRAFT_REVIEW
  ) {
    return "write_draft";
  }
  return "converse";
}
