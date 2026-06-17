/** 报告初稿生成节点。框架 createLlmStreamNode（流式 + 失败复用上版草稿 fallback）。 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "../../../src/runtime/index.js";
import { requireModel } from "../../shared.js";
import { createLlmStreamNode } from "../../../src/libs/nodes/index.js";
import type { ResearchStateShape } from "./types.js";
import { langClause, llmLongTimeout } from "./helpers.js";

const log = logger.child("deep-research");

/**
 * draft：LLM 基于全部调研结果流式生成报告初稿。
 * 重写轮把质量评审意见喂回去改进；流式失败 → 复用上一版草稿（fallback）。
 */
export function createDraftNode(appConfig?: AppConfig) {
  return createLlmStreamNode<ResearchStateShape>({
    model: () => requireModel(appConfig, "deep-research 示例"),
    prompt: (s) => {
      const isRewrite = s.draftAttempts > 0 && Boolean(s.draftCritique);
      const material = s.findings
        .map((f) => `## ${f.title}\n${f.summary}`)
        .join("\n\n---\n\n");
      return [
        new SystemMessage(
          `你是资深技术写作专家。根据调研资料，为「${s.refinedTopic}」撰写一份结构清晰、逻辑连贯的研究报告。` +
            `报告应包含引言、各章节分析、结论与建议。Markdown 格式，800-2000 字。不要堆砌链接，聚焦洞察。` +
            (isRewrite ? `\n质量评审意见（据此改进）：${s.draftCritique}` : "") +
            langClause(s.languageHint)
        ),
        new HumanMessage(`调研资料：\n${material}`),
      ];
    },
    write: (r, s) => {
      const isRewrite = s.draftAttempts > 0 && Boolean(s.draftCritique);
      log.info("draft", { length: r.text.length, attempt: s.draftAttempts + 1, isRewrite });
      return { draft: r.text, draftStreamed: r.streamed, draftAttempts: s.draftAttempts + 1 };
    },
    fallback: (s) => {
      const material = s.findings
        .map((f) => `## ${f.title}\n${f.summary}`)
        .join("\n\n---\n\n");
      log.warn("draft 生成失败 → 复用上一版草稿", { attempt: s.draftAttempts + 1 });
      return {
        draft: s.draft || material.slice(0, 2000),
        draftStreamed: false,
        draftAttempts: s.draftAttempts + 1,
      };
    },
    config: appConfig,
    label: "draft",
    retryLabel: "draft streaming LLM",
    timeoutMs: llmLongTimeout(appConfig),
  });
}
