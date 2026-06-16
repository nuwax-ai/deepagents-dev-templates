/** 并行调研节点。 */

import { Send, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "../../../src/vendor/runtime/index.js";
import type { FlowCallbacks } from "../../../src/surfaces/flow-types.js";
import { emitPlan, emitStage, extractText, requireModel, runTool } from "../../shared.js";
import { callResolvedMcpTool, rateLimited, type McpServerConfig } from "../../mcp-client.js";
import type { ResearchStateShape } from "./types.js";
import { invokeLLM, langClause } from "./helpers.js";
import { outlineToPlanEntries } from "./planning.js";

const log = logger.child("deep-research");

/** 单次 research 节点的 MCP 搜索超时。 */
const SEARCH_TIMEOUT_MS = 20000;

/** 网络搜索 MCP（duckduckgo-mcp-server，免 key；与 travel-planner 同源）。 */
const SEARCH_MCP: McpServerConfig = {
  command: "npx",
  args: ["-y", "duckduckgo-mcp-server"],
};

/**
 * fanoutToResearch：条件边函数 — 为每个 outline section 派一个 research 实例（Send 扇出）。
 * 导出供单测。
 */
export function fanoutToResearch(state: ResearchStateShape): Send[] {
  return state.outline.map(
    (section) =>
      new Send("research", {
        currentSection: section,
        outline: state.outline,
        refinedTopic: state.refinedTopic,
        languageHint: state.languageHint,
      })
  );
}

/**
 * research：对单个 section 发一次 duckduckgo 网络搜索（rateLimited 节流），
 * 然后 LLM 把搜索结果整理成结构化摘要。
 */
export async function researchNode(
  state: ResearchStateShape,
  config?: LangGraphRunnableConfig
): Promise<Partial<ResearchStateShape>> {
  const onToolCall = config?.configurable?.onToolCall as
    | FlowCallbacks["onToolCall"]
    | undefined;
  const section = state.currentSection;
  const query = section.query;
  await emitPlan(config, outlineToPlanEntries(state.outline, { currentTitle: section.title }));
  await emitStage(config, { stage: "调研", detail: section.title });

  const { result: searchResult, ok } = await runTool(
    "duckduckgo_search",
    { query },
    () =>
      rateLimited(
        () =>
          callResolvedMcpTool(
            SEARCH_MCP,
            "duckduckgo_search",
            { query, count: 5 },
            { timeoutMs: SEARCH_TIMEOUT_MS }
          )
      ),
    onToolCall
  );

  const rawMaterial = ok
    ? searchResult.slice(0, 1200)
    : `（搜索失败：${searchResult}，将基于主题常识整理）`;

  const appConfig = config?.configurable?.appConfig as AppConfig | undefined;
  const model = requireModel(appConfig, "deep-research 示例");
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
    ], appConfig);
    summary = extractText(res.content).trim();
  } catch (err) {
    log.warn("research 整理失败 → 降级", { section: section.title, error: String(err) });
    summary = ok ? rawMaterial.slice(0, 400) : `（${section.title} 资料获取失败，该章节将基于其他已有内容推断）`;
  }
  log.info("research done", { section: section.title, summaryLen: summary.length });
  return {
    findings: [{ title: section.title, searchResult: rawMaterial, summary }],
  };
}
