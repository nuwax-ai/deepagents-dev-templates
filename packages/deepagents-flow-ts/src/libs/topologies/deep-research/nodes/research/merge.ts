/**
 * 双源检索结果合并 —— Context7 + DuckDuckGo 并行后取优（deep-research 示例专用）。
 */

import { isDdgErrorText } from "./tools.js";

export type ResearchSourceKind = "context7" | "duckduckgo";

/** 单路检索结果（score 可由 mergeResearchSources 计算）。 */
export interface ResearchSourceResult {
  source: ResearchSourceKind;
  text: string;
  ok: boolean;
  score?: number;
  libraryId?: string;
}

/** 判定检索正文是否为失败/空结果（含 DDG Error 正文）。 */
export function isSourceFailureText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (isDdgErrorText(t)) return true;
  return /^（搜索失败|搜索无结果|Context7/i.test(t);
}

/**
 * 启发式打分（0–100）：用于双源取优，不调 LLM。
 */
export function scoreResearchSource(
  source: ResearchSourceKind,
  text: string,
  ok: boolean,
  query: string,
  opts: { libraryId?: string } = {}
): number {
  if (!ok || isSourceFailureText(text)) return 0;

  let score = 0;
  if (source === "context7" && opts.libraryId) score += 40;

  const len = text.length;
  if (len >= 200 && len <= 2000) score += 20;
  else if (len >= 80) score += 10;

  if (/```|api|version|\b(v?\d+\.\d+)/i.test(text)) score += 15;

  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (words.length) {
    const lower = text.toLowerCase();
    const hits = words.filter((w) => lower.includes(w)).length;
    score += Math.round((hits / words.length) * 25);
  }

  return Math.min(100, score);
}

const SOURCE_LABEL: Record<ResearchSourceKind, string> = {
  context7: "Context7 文档",
  duckduckgo: "DuckDuckGo 网络",
};

/**
 * 按 score 取主源；次源 score ≥ 30 时作为补充拼接。
 */
export function mergeResearchSources(
  sources: ResearchSourceResult[],
  query: string
): string {
  const ranked = sources
    .map((s) => ({
      ...s,
      score: s.score ?? scoreResearchSource(s.source, s.text, s.ok, query, { libraryId: s.libraryId }),
    }))
    .sort((a, b) => b.score - a.score);

  const viable = ranked.filter((s) => s.score > 0);
  if (!viable.length) {
    const fallback = ranked.find((s) => s.text.trim());
    return fallback?.text ?? `（检索失败：${query}；将基于主题常识整理）`;
  }

  const primary = viable[0]!;
  const secondary = viable.find((s) => s.source !== primary.source && s.score >= 30);

  const primaryBlock = `【主源：${SOURCE_LABEL[primary.source]}】\n${primary.text}`;
  if (!secondary) return primaryBlock;

  return `${primaryBlock}\n\n---\n\n【补充：${SOURCE_LABEL[secondary.source]}】\n${secondary.text}`;
}
