/** 大纲与报告质量评审节点（用 createLlmRouterNode 收口「LLM 裁决 → Command goto」）。 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { AppConfig } from "../../../../runtime/index.js";
import {
  requireModel,
  parseJson,
  createLlmRouterNode,
} from "../../../nodes/index.js";
import type { ResearchStateShape } from "./types.js";

/** 大纲评审重试上限（防 reflection 死循环）。 */
export const MAX_OUTLINE_REVIEW = 2;
/** 初稿质量评审重试上限。 */
export const MAX_DRAFT_REVIEW = 2;

/**
 * outline_review：LLM 评审并行调研结果是否充分覆盖大纲。
 * 不充分且未达上限 → 带 critique 回 plan 重规划；否则 → write_draft。
 * 用 createLlmRouterNode 收口「调 LLM + parse + 包 Command + catch 放行」样板（route 内调 routeAfterOutlineReview）。
 */
export function outlineReviewNode(state: ResearchStateShape, appConfig?: AppConfig) {
  return createLlmRouterNode<ResearchStateShape>({
    model: () => requireModel(appConfig, "deep-research 示例"),
    prompt: (s) => [
      new SystemMessage(
        `你是研究评审。判断调研结果是否充分覆盖了大纲的所有章节、每章是否有实质内容。` +
          `只输出 JSON：{"verdict":"sufficient"|"insufficient","critique":"一句话说明缺什么，或为何可通过"}。`
      ),
      new HumanMessage(
        `主题：${s.refinedTopic}\n大纲章节：${s.outline.map((sec) => sec.title).join("、")}\n\n调研摘要：\n${s.findings
          .map((f) => `## ${f.title}\n${f.summary.slice(0, 200)}...`)
          .join("\n\n")}`
      ),
    ],
    parse: (t) => parseJson<{ verdict?: string; critique?: string }>(t),
    route: (parsed, s) => {
      const v = parsed as { verdict?: string; critique?: string };
      const verdict = v.verdict === "insufficient" ? "insufficient" : "sufficient";
      const update = { outlineDecision: verdict, outlineCritique: v.critique ?? "" };
      return { goto: routeAfterOutlineReview({ ...s, ...update }), update };
    },
    routeFallback: (s) => {
      const update = { outlineDecision: "sufficient", outlineCritique: "(评审异常，已放行)" };
      return { goto: routeAfterOutlineReview({ ...s, ...update }), update };
    },
    config: appConfig,
    attempts: 1,
    label: "outline_review",
  })(state);
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
 * quality_review：LLM 评审报告质量（结构/论据/逻辑/遗漏）。
 * 不达标且未达上限 → 带 critique 回 write_draft 重写；否则 → converse 进入持续会话。
 */
export function qualityReviewNode(state: ResearchStateShape, appConfig?: AppConfig) {
  return createLlmRouterNode<ResearchStateShape>({
    model: () => requireModel(appConfig, "deep-research 示例"),
    prompt: (s) => [
      new SystemMessage(
        `你是报告质量评审。判断报告是否：结构完整、论据充分、逻辑连贯、无明显遗漏。` +
          `只输出 JSON：{"verdict":"pass"|"fail","critique":"一句话说明问题，或为何通过"}。`
      ),
      new HumanMessage(
        `主题：${s.refinedTopic}\n报告（前 2000 字）：\n${s.draft.slice(0, 2000)}`
      ),
    ],
    parse: (t) => parseJson<{ verdict?: string; critique?: string }>(t),
    route: (parsed, s) => {
      const v = parsed as { verdict?: string; critique?: string };
      const verdict = v.verdict === "fail" ? "fail" : "pass";
      const update = { draftDecision: verdict, draftCritique: v.critique ?? "" };
      return { goto: routeAfterQualityReview({ ...s, ...update }), update };
    },
    routeFallback: (s) => {
      const update = { draftDecision: "pass", draftCritique: "(评审异常，已放行)" };
      return { goto: routeAfterQualityReview({ ...s, ...update }), update };
    },
    config: appConfig,
    attempts: 1,
    label: "quality_review",
  })(state);
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
