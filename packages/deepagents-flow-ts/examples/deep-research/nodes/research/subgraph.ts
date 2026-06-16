/**
 * research 子图 —— 单章节调研（确定性搜索 + LLM 摘要）。
 *
 *   START → prepare(阶段进度) → search(StructuredTool 一次) → summarize → END
 *
 * 不用 ReAct 循环：每章节固定 `section.query` 搜一次，避免模型重复调工具放大 DDG 限流。
 * Send 扇出 N 路时，search 经 invokeDuckDuckGoSearch 内全局 rateLimited 串行错峰。
 *
 * 编译后作为父图 `research` 节点。
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
import {
  emitPlan,
  emitStage,
  extractText,
  requireModel,
  runTool,
} from "../../../shared.js";
import type { OutlineSection, ResearchFinding } from "../types.js";
import { invokeLLM, langClause } from "../helpers.js";
import { outlineToPlanEntries } from "../planning.js";
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
 * search：每章节确定性调用一次 duckduckgo_search（StructuredTool 底层实现）。
 * runTool 透出 onToolCall 三态，与 travel-planner / 旧版 deep-research 一致。
 */
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

    const { result, ok } = await runTool(
      "duckduckgo_search",
      { query },
      async () => {
        const { text } = await invokeDuckDuckGoSearch(query);
        return text;
      },
      onToolCall
    );

    if (!ok) {
      log.warn("research 搜索未成功，summarize 将降级", {
        section: section.title,
        snippet: result.slice(0, 80),
      });
    }

    return { rawMaterial: result };
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
              `若资料标明搜索失败，可结合主题常识简要推断，并注明依据有限。` +
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
