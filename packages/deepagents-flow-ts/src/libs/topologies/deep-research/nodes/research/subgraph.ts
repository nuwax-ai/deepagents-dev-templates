/**
 * research 子图 —— 单章节调研（平台文档 MCP + LLM 摘要）。
 *
 *   START → prepare → search(文档 MCP) → summarize → END
 *
 * docMcp 缺省 → 降级文案；mergeResearchSources 保留多源合并能力供扩展。
 */

import {
  StateGraph,
  START,
  END,
  Annotation,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "../../../../../runtime/index.js";
import type { FlowCallbacks } from "../../../../../core/flow-types.js";
import { requireModel } from "../../../../nodes/index.js";
import { emitPlan, emitStage, extractText, runTool } from "../../../../nodes/index.js";
import type { OutlineSection, ResearchFinding } from "../types.js";
import { invokeLLM, langClause } from "../helpers.js";
import { outlineToPlanEntries } from "../planning.js";
import { invokeDocRetrieval, type DocRetrievalMcp } from "./doc-retrieval.js";
import { mergeResearchSources, type ResearchSourceResult } from "./merge.js";

const log = logger.child("deep-research");

/** 子图 state：与父图重叠字段 + 本章检索原文。 */
const ResearchSectionState = Annotation.Root({
  currentSection: Annotation<OutlineSection>,
  refinedTopic: Annotation<string>,
  languageHint: Annotation<string>,
  outline: Annotation<OutlineSection[]>,
  rawMaterial: Annotation<string>,
  findings: Annotation<ResearchFinding[]>({
    reducer: (a, b) => [...(a ?? []), ...(b ?? [])],
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

async function fetchDocSources(
  docMcp: DocRetrievalMcp | undefined,
  query: string,
  libraryHint: string | undefined,
  onToolCall: FlowCallbacks["onToolCall"] | undefined
): Promise<ResearchSourceResult[]> {
  let meta: { ok: boolean; libraryId?: string } = { ok: false };
  const args = libraryHint ? { query, libraryHint } : { query };
  const doc = await runTool(
    "doc_retrieval",
    args,
    async () => {
      const r = await invokeDocRetrieval(docMcp, query, libraryHint);
      meta = { ok: r.ok, libraryId: r.libraryId };
      return r.text;
    },
    onToolCall
  );
  return [{ source: "docs", text: doc.result, ok: meta.ok, libraryId: meta.libraryId }];
}

function createSearchNode(docMcp?: DocRetrievalMcp) {
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

    const sources = await fetchDocSources(docMcp, query, libraryHint, onToolCall);
    const rawMaterial = mergeResearchSources(sources, query);

    if (!sources.some((s) => s.ok)) {
      log.warn("research 检索未成功，summarize 将降级", {
        section: section.title,
        snippet: rawMaterial.slice(0, 80),
      });
    } else {
      log.info("research 检索完成", {
        section: section.title,
        libraryHint: libraryHint ?? null,
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

/** 编译单章节调研子图；父图 `.addNode("research", createResearchSectionSubgraph(appConfig, docMcp))`。 */
export function createResearchSectionSubgraph(
  appConfig?: AppConfig,
  docMcp?: DocRetrievalMcp
) {
  return new StateGraph(ResearchSectionState)
    .addNode("prepare", createPrepareNode())
    .addNode("search", createSearchNode(docMcp))
    .addNode("summarize", createSummarizeNode(appConfig))
    .addEdge(START, "prepare")
    .addEdge("prepare", "search")
    .addEdge("search", "summarize")
    .addEdge("summarize", END)
    .compile();
}
