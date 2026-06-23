/**
 * Binary yes/no LLM grader —— 评分原语。
 *
 * grade_documents（逐文档相关性）与 grade_generation（幻觉 / 答案相关性）共用同一套
 * 「invokeWithResilience → extractText → parseJson<{binary_score}> → toLowerCase==='yes'」逻辑，
 * 仅 systemPrompt / userPrompt 不同。抽此公共 helper 消除两份重复实现。
 *
 * 调用 / 解析异常 → defaultValue（保守）：grade_documents 默认保留文档、grade_generation 默认放行，
 * 避免评分抖动或瞬态失败卡死整条图（与各节点的「无凭证兜底」一致）。
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { type AppConfig } from "../../../../runtime/index.js";
import {
  resolveLlmResilience,
  invokeWithResilience,
} from "../../../../runtime/services/llm-resilience.js";
import { extractText, parseJson, type ChatModelLike } from "../../../nodes/index.js";

export interface BinaryGradeOptions {
  appConfig?: AppConfig;
  label?: string;
  /** 调用 / 解析异常时的默认裁决（保守策略）。 */
  defaultValue?: boolean;
}

/**
 * 二分 yes/no 评分。attempts=1 不重试（评分抖动不应重试放大延迟）。
 * 超时取自 resolveLlmResilience(appConfig).shortTimeoutMs（与 createLlmNode 一致）。
 */
export async function gradeBinaryYesNo(
  model: ChatModelLike,
  systemPrompt: string,
  userPrompt: string,
  opts: BinaryGradeOptions = {}
): Promise<boolean> {
  const { appConfig, label = "binary-grade", defaultValue = true } = opts;
  const { shortTimeoutMs } = resolveLlmResilience(appConfig);
  try {
    const ai = (await invokeWithResilience(
      model,
      [new SystemMessage(systemPrompt), new HumanMessage(userPrompt)],
      {
        timeoutMs: shortTimeoutMs,
        label,
        retryLabel: label,
        useSharedLimiter: true,
        attempts: 1,
        config: appConfig,
      }
    )) as { content: unknown };
    const parsed = parseJson<{ binary_score?: string }>(extractText(ai.content));
    return (parsed.binary_score ?? "").toLowerCase() === "yes";
  } catch {
    // 评分原语不抛——异常走 defaultValue（保守），交由调用方决定保留 / 放行。
    return defaultValue;
  }
}
