/**
 * deep-research 节点共享 helper。
 *
 * LLM 调用约定（框架优先对照）：
 *  - 模型自主选工具 → bindTools + ToolNode + toolsCondition（见 research/subgraph.ts）
 *  - 确定性流水线步骤（plan/draft/review）→ invokeLLM 直调（LangGraph 无预置 plan 节点）
 *  - 固定入参的外部工具 → StructuredTool.invoke（不必强行套 ToolNode）
 */

import type { BaseMessage } from "@langchain/core/messages";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { AppConfig } from "../../../src/runtime/index.js";
import {
  extractText,
  getSharedLlmLimiter,
  invokeWithResilience,
  resolveLlmResilience,
  withRetry,
  withTimeout,
  emitTextToken,
} from "../../shared.js";

export type LLMLike = {
  invoke: (messages: BaseMessage[]) => Promise<{ content: unknown }>;
  stream?: (messages: BaseMessage[]) =>
    | Promise<AsyncIterable<{ content?: unknown }>>
    | AsyncIterable<{ content?: unknown }>;
};

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
 * 从 LLM 文本里抽出第一段 JSON（容忍 ```json 围栏与前后说明文字）。
 */
export function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error(`LLM 未返回 JSON：${text.slice(0, 200)}`);
  const close = cleaned[start] === "[" ? "]" : "}";
  const end = cleaned.lastIndexOf(close);
  if (end <= start) throw new Error(`LLM JSON 不完整：${text.slice(0, 200)}`);
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
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

/**
 * 流式调模型：只用于用户可见的大段输出（draft/respond）。
 */
export async function streamLLMText(
  m: LLMLike,
  messages: BaseMessage[],
  appConfig: AppConfig | undefined,
  config: LangGraphRunnableConfig | undefined,
  timeoutMs: number
): Promise<{ text: string; streamed: boolean }> {
  const hasVisibleTokenSink = Boolean(
    (config?.configurable as { onToken?: unknown } | undefined)?.onToken
  );

  if (!m.stream || !hasVisibleTokenSink) {
    const res = await invokeLLM(m, messages, appConfig, timeoutMs);
    return { text: extractText(res.content), streamed: false };
  }

  const run = async () => {
    let full = "";
    const stream = await Promise.resolve(m.stream!(messages));
    for await (const chunk of stream) {
      const text = extractText(chunk.content);
      if (!text) continue;
      full += text;
      emitTextToken(config, text);
    }
    return full;
  };

  const text = await getSharedLlmLimiter(appConfig)(() =>
    withRetry(
      () => withTimeout(run(), timeoutMs, "deep-research 流式调模型"),
      { label: "deep-research streaming LLM" }
    )
  );
  return { text, streamed: true };
}
