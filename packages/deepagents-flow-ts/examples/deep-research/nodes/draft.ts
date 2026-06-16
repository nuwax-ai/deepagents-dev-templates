/** 报告初稿生成节点。 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { logger, type AppConfig } from "../../../src/runtime/index.js";
import { requireModel } from "../../shared.js";
import type { ResearchStateShape } from "./types.js";
import { langClause, llmLongTimeout, streamLLMText } from "./helpers.js";

const log = logger.child("deep-research");

/**
 * draft：LLM 基于全部调研结果生成报告初稿。
 * 重写轮把质量评审意见喂回去改进。
 */
export async function draftNode(
  state: ResearchStateShape,
  appConfig?: AppConfig,
  config?: LangGraphRunnableConfig
): Promise<Partial<ResearchStateShape>> {
  const model = requireModel(appConfig, "deep-research 示例");
  const isRewrite = state.draftAttempts > 0 && Boolean(state.draftCritique);
  const material = state.findings
    .map((f) => `## ${f.title}\n${f.summary}`)
    .join("\n\n---\n\n");
  let draft: string;
  let draftStreamed = false;
  try {
    const streamed = await streamLLMText(model, [
      new SystemMessage(
        `你是资深技术写作专家。根据调研资料，为「${state.refinedTopic}」撰写一份结构清晰、逻辑连贯的研究报告。` +
          `报告应包含引言、各章节分析、结论与建议。Markdown 格式，800-2000 字。不要堆砌链接，聚焦洞察。` +
          (isRewrite ? `\n质量评审意见（据此改进）：${state.draftCritique}` : "") +
          langClause(state.languageHint)
      ),
      new HumanMessage(`调研资料：\n${material}`),
    ], appConfig, config, llmLongTimeout(appConfig));
    draft = streamed.text.trim();
    draftStreamed = streamed.streamed;
  } catch (err) {
    log.warn("draft 生成失败 → 复用上一版草稿", { attempt: state.draftAttempts + 1, error: String(err) });
    draft = state.draft || material.slice(0, 2000);
  }
  log.info("draft", { length: draft.length, attempt: state.draftAttempts + 1, isRewrite });
  return { draft, draftStreamed, draftAttempts: state.draftAttempts + 1 };
}
