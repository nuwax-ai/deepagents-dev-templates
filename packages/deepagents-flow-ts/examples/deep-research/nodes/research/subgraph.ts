/**
 * research 子图 —— 单章节调研（双源并行检索 + LLM 摘要）。
 *
 *   START → prepare → search(Context7 ∥ DDG 取优合并) → summarize → END
 *
 * 每章节固定各搜一次；DDG 走 rateLimited 闸门，Context7 独立并行。
 * Send 扇出 N 路时，DDG 请求在章节间全局串行错峰。
 */

import {
  StateGraph,
  START,
  END,
  Annotation,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "../../../../src/runtime/index.js";
import type { FlowCallbacks } from "../../../../src/surfaces/flow-types.js";
import { requireModel } from "../../../shared.js";
import { emitPlan, emitStage, extractText, runTool } from "../../../../src/libs/nodes/index.js";
import type { OutlineSection, ResearchFinding } from "../types.js";
import { invokeLLM, langClause } from "../helpers.js";
import { outlineToPlanEntries } from "../planning.js";
import { invokeContext7Search } from "./context7.js";
import { mergeResearchSources, type ResearchSourceResult } from "./merge.js";
import { invokeDuckDuckGoSearch } from "./tools.js";

const log = logger.child("deep-research");

/** 子图 state：与父图重叠字段 + 本章检索原文。 */
const ResearchSectionState = Annotation.Root({
  currentSection: Annotation<OutlineSection>,
  refinedTopic: Annotation<string>,
  languageHint: Annotation<string>,
  outline: Annotation<OutlineSection[]>,
  rawMaterial: Annotation<string>,
  findings: Annotation<ResearchFinding[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

type SectionState = typeof ResearchSectionState.State;

/** prepare：透出阶段进度与 ACP Plan。 */
function createPrepareNode() {
  return async (
    state: SectionState,
    config?: LangGraphRunnableConfig
  ): Promise<Partial<SectionState>> => {
    const section = state.currentSection;
    await emitPlan(config, outlineToPlanEntries(state.outline, { currentTitle: section.title }));
    await emitStage(config, { stage: "调研", detail: section.title });
    return { rawMaterial: "" };
  };
}

/**
 * 并行拉 Context7 文档 + DuckDuckGo 网络，merge 取优后写入 rawMaterial。
 * libraryHint 来自 plan 大纲，优先用于 Context7 resolve-library-id。
 */
async function fetchDualSources(
  query: string,
  libraryHint: string | undefined,
  onToolCall: FlowCallbacks["onToolCall"] | undefined
): Promise<ResearchSourceResult[]> {
  let c7Meta: { ok: boolean; libraryId?: string } = { ok: false };
  let ddgMeta: { ok: boolean } = { ok: false };

  const c7Args = libraryHint ? { query, libraryHint } : { query };

  const context7Task = runTool(
    "context7_query",
    c7Args,
    async () => {
      const r = await invokeContext7Search(query, libraryHint);
      c7Meta = { ok: r.ok, libraryId: r.libraryId };
      return r.text;
    },
    onToolCall
  );

  const ddgTask = runTool(
    "duckduckgo_search",
    { query },
    async () => {
      const r = await invokeDuckDuckGoSearch(query);
      ddgMeta = { ok: r.ok };
      return r.text;
    },
    onToolCall
  );

  const [c7, ddg] = await Promise.all([context7Task, ddgTask]);

  return [
    {
      source: "context7",
      text: c7.result,
      ok: c7Meta.ok,
      libraryId: c7Meta.libraryId,
    },
    {
      source: "duckduckgo",
      text: ddg.result,
      ok: ddgMeta.ok,
    },
  ];
}

/** search：双源并行检索 + 取优合并。 */
function createSearchNode() {
  return async (
    state: SectionState,
    config?: LangGraphRunnableConfig
  ): Promise<Partial<SectionState>> => {
    const onToolCall = config?.configurable?.onToolCall as
      | FlowCallbacks["onToolCall"]
      | undefined;
    const section = state.currentSection;
    const query = section.query;
    const libraryHint = section.libraryHint;

    const sources = await fetchDualSources(query, libraryHint, onToolCall);
    const rawMaterial = mergeResearchSources(sources, query);
    const anyOk = sources.some((s) => s.ok);

    if (!anyOk) {
      log.warn("research 双源均未成功，summarize 将降级", {
        section: section.title,
        snippet: rawMaterial.slice(0, 80),
      });
    } else {
      log.info("research 双源合并完成", {
        section: section.title,
        libraryHint: libraryHint ?? null,
        sources: sources.map((s) => ({ source: s.source, ok: s.ok })),
      });
    }

    return { rawMaterial };
  };
}

/** summarize：把检索结果整理成结构化章节摘要，写回父图 findings。 */
function createSummarizeNode(appConfig?: AppConfig) {
  return async (state: SectionState): Promise<Partial<SectionState>> => {
    const section = state.currentSection;
    const rawMaterial =
      state.rawMaterial ||
      `（未检索到资料；将基于主题常识整理。建议检索词：${section.query}）`;

    const model = requireModel(appConfig, "deep-research 示例");
    let summary: string;
    try {
      const res = await invokeLLM(
        model,
        [
          new SystemMessage(
            `你是技术分析师。根据检索资料，为章节「${section.title}」写一段 200-400 字的结构化摘要。` +
              `提取关键事实、数据、结论，不要堆砌链接。只输出摘要正文。` +
              `资料可能含 Context7 文档与 DuckDuckGo 网络两路来源，请综合主源与补充。` +
              `若资料标明检索失败，可结合主题常识简要推断，并注明依据有限。` +
              langClause(state.languageHint)
          ),
          new HumanMessage(
            `主题：${state.refinedTopic}\n章节：${section.title}\n检索资料：\n${rawMaterial}`
          ),
        ],
        appConfig
      );
      summary = extractText(res.content).trim();
    } catch (err) {
      log.warn("research summarize 失败 → 降级", { section: section.title, error: String(err) });
      summary = state.rawMaterial
        ? state.rawMaterial.slice(0, 400)
        : `（${section.title} 资料获取失败，该章节将基于其他已有内容推断）`;
    }

    log.info("research done", { section: section.title, summaryLen: summary.length });
    return {
      findings: [{ title: section.title, searchResult: rawMaterial, summary }],
    };
  };
}

/** 编译单章节调研子图；父图 `.addNode("research", createResearchSectionSubgraph(appConfig))`。 */
export function createResearchSectionSubgraph(appConfig?: AppConfig) {
  return new StateGraph(ResearchSectionState)
    .addNode("prepare", createPrepareNode())
    .addNode("search", createSearchNode())
    .addNode("summarize", createSummarizeNode(appConfig))
    .addEdge(START, "prepare")
    .addEdge("prepare", "search")
    .addEdge("search", "summarize")
    .addEdge("summarize", END)
    .compile();
}
