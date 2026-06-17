/** 选题确认与大纲规划节点。 */

import { Command, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { fanoutToResearch } from "./fanout.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { AppConfig } from "../../../src/runtime/index.js";
import { requireModel } from "../../shared.js";
import {
  extractText,
  emitPlan,
  parseJson,
  createHumanApprovalNode,
} from "../../../src/libs/nodes/index.js";
import type { OutlineSection, ResearchFinding, ResearchStateShape } from "./types.js";
import { extractLanguageHint, invokeLLM, langClause } from "./helpers.js";

/**
 * clarify：interrupt① — 与用户确认/调整研究主题（框架 createHumanApprovalNode）。
 * 非通过类回复 → refinedTopic 追加方向；并提取语言偏好。
 */
export const clarifyNode = createHumanApprovalNode<ResearchStateShape>({
  question: (s) =>
    `🔬 研究主题：「${s.topic}」\n\n` +
    `确认研究这个主题，或提供更具体的方向（如：聚焦某个技术栈、某个场景、某个对比维度）。\n` +
    `直接回复「ok」确认，或输入你的调整。`,
  write: (feedback, approved, s) => {
    const languageHint = extractLanguageHint(feedback);
    return {
      refinedTopic: feedback && !approved ? `${s.topic}（方向：${feedback}）` : s.topic,
      ...(languageHint ? { languageHint } : {}),
    };
  },
});

/** 规范化 plan 输出的大纲章节（修剪 libraryHint、过滤空项）。 */
export function normalizeOutlineSections(sections: OutlineSection[]): OutlineSection[] {
  return sections
    .map((s) => {
      const title = String(s.title ?? "").trim();
      const query = String(s.query ?? "").trim();
      const hint = String(s.libraryHint ?? "").trim();
      return {
        title,
        query,
        ...(hint ? { libraryHint: hint } : {}),
      };
    })
    .filter((s) => s.title && s.query);
}

/** 大纲 → ACP Plan entries；可按当前章节/已完成章节标记状态。 */
export function outlineToPlanEntries(
  outline: OutlineSection[],
  opts: { currentTitle?: string; completedTitles?: string[] } = {}
) {
  const completed = new Set(opts.completedTitles ?? []);
  return outline.map((section) => ({
    content: section.libraryHint
      ? `${section.title}（搜索：${section.query}；库：${section.libraryHint}）`
      : `${section.title}（搜索：${section.query}）`,
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
 *
 * 保留 bespoke——emitPlan(config, ...) 副作用需 LangGraphRunnableConfig（经 writer 发 Plan），
 * createLlmNode 的 write 回调不收 config，硬塞会失真。
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
        `每章节含：title（标题）、query（检索关键词，英文优先）、libraryHint（可选，Context7 文档库名，如 langgraph、react、typescript；` +
        `涉及具体框架/SDK/API 的章节应填写，纯概念/行业综述章节可省略或留空字符串）。` +
        `只输出 JSON 数组：[{"title":"...","query":"...","libraryHint":"..."}]，不要解释。` +
        (isReplan ? `\n上一轮评审意见（据此改进大纲）：${state.outlineCritique}` : "") +
        langClause(state.languageHint)
    ),
    new HumanMessage(`研究主题：${state.refinedTopic}`),
  ], appConfig);
  const sections = normalizeOutlineSections(parseJson<OutlineSection[]>(extractText(res.content)));
  await emitPlan(config, outlineToPlanEntries(sections));
  const isUserRevise = state.outlineDecision === "user_revise";
  return {
    outline: sections,
    findings: null as unknown as ResearchFinding[],
    outlineAttempts: isUserRevise ? state.outlineAttempts : state.outlineAttempts + 1,
  };
}

/**
 * outlineGate：interrupt② — 把大纲抛给用户确认（框架 createHumanApprovalNode(route)）。
 * 路由用 Command：用户改大纲 → goto plan；确认 → Send 扇出 research 子图。
 */
export const outlineGateNode = createHumanApprovalNode<ResearchStateShape>({
  question: (s) => {
    const list = s.outline
      .map((sec, i) => {
        const lib = sec.libraryHint ? `；库：${sec.libraryHint}` : "";
        return `${i + 1}. ${sec.title}（搜索：${sec.query}${lib}）`;
      })
      .join("\n");
    return (
      `📋 研究大纲（${s.refinedTopic}）：\n${list}\n\n` +
      `确认大纲开始调研，或回复调整意见。\n直接回复「ok」确认。`
    );
  },
  route: (approved, feedback, s) => {
    const languageHint = extractLanguageHint(feedback);
    if (feedback && !approved) {
      return new Command({
        goto: "plan",
        update: {
          outlineCritique: feedback,
          outlineDecision: "user_revise",
          ...(languageHint ? { languageHint } : {}),
        },
      });
    }
    const nextState = {
      ...s,
      outlineDecision: "ok",
      ...(languageHint ? { languageHint } : {}),
    } as ResearchStateShape;
    return new Command({
      goto: fanoutToResearch(nextState),
      update: {
        outlineDecision: "ok",
        ...(languageHint ? { languageHint } : {}),
      },
    });
  },
});
