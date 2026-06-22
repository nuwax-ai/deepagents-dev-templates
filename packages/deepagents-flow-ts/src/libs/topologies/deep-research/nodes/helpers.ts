/**
 * deep-research 节点共享 helper（示例专属）。
 *
 * 仅保留 deep-research 本地、非通用件：
 *  - 语言偏好提取（extractLanguageHint / langClause）
 *  - 调模型薄配置糖（invokeLLM / llmLongTimeout）—— 经模板韧性原语 invokeWithResilience
 *
 * 通用件已下沉框架：extractText/parseJson/streamLLMText/emit* → src/libs/nodes；
 * 韧性原语 → src/runtime/services/llm-resilience。
 *
 * LLM 调用约定（框架优先对照）：
 *  - 外部搜索 → Context7 文档检索（duckduckgo 实测不稳定已移除，原双源改单源）
 *  - 确定性流水线步骤（plan/draft/review）→ invokeLLM 直调
 */

import type { BaseMessage } from "@langchain/core/messages";
import type { AppConfig } from "../../../../runtime/index.js";
import {
  invokeWithResilience,
  resolveLlmResilience,
} from "../../../../runtime/services/llm-resilience.js";
import type { LLMLike } from "../../../nodes/index.js";

/**
 * 从用户自由文本中提取语言偏好指令（"用中文" → "请以中文输出"）。无明确偏好返回 ""。
 */
export function extractLanguageHint(text: string): string {
  if (/用?中文|chinese/i.test(text)) return "请以中文输出";
  if (/用?英文|english/i.test(text)) return "Please output in English";
  if (/用?日(语|文)|japanese/i.test(text)) return "日本語で出力してください";
  if (/용?한국어|korean/i.test(text)) return "한국어로 출력해 주세요";
  return "";
}

/** 生成追加在 SystemMessage 末尾的语言要求子句（空字符串表示无偏好）。 */
export function langClause(hint: string): string {
  return hint ? `\n\n**语言要求：${hint}**` : "";
}

/**
 * 调模型 —— 模板 invokeWithResilience + 共享并发闸门（Send 扇出必备）。
 */
export function invokeLLM(
  m: LLMLike,
  messages: BaseMessage[],
  appConfig: AppConfig | undefined,
  timeoutMs?: number
): Promise<{ content: unknown }> {
  const { shortTimeoutMs } = resolveLlmResilience(appConfig);
  return invokeWithResilience(m, messages, {
    timeoutMs: timeoutMs ?? shortTimeoutMs,
    label: "deep-research 调模型",
    retryLabel: "deep-research LLM",
    useSharedLimiter: true,
    config: appConfig,
  });
}

/** 长调用超时别名（draft / respond），与模板 LLM_TIMEOUT_LONG_MS 同源。 */
export const llmLongTimeout = (appConfig?: AppConfig) =>
  resolveLlmResilience(appConfig).longTimeoutMs;
