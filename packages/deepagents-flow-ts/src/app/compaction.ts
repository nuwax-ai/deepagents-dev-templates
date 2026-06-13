/**
 * 上下文压缩 —— 超阈值时裁剪 + LLM 摘要旧消息。
 *
 * 框架优先：裁剪用 core `trimMessages`；摘要用标准 LLM invoke（产出一条 SystemMessage）。
 * 消费 config.compaction（contextWindow / triggerThreshold / keepRecentTokens）。
 *
 * 三个分支：
 *  - 未超阈值 → 原样返回
 *  - 超阈值 + 有凭证 → 保留最近 keepRecentTokens + LLM 摘要旧部分成 SystemMessage
 *  - 超阈值 + 无凭证 → 仅 trimMessages 裁剪（不摘要，避免调模型）
 *
 * 典型接入：StatefulFlow.run 入口 load history → compactHistory → 作为初始 messages 传图
 * （见 examples/dev-agent）。默认图（one-shot）单 turn，历史不增长，压缩不触发。
 */

import {
  trimMessages,
  SystemMessage,
  HumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { resolveModel, logger, type AppConfig } from "deepagents-app-ts/runtime";

const log = logger.child("compaction");

/** 粗估 token 数（char / 4）。用于触发判定与裁剪。 */
export function estimateTokens(messages: BaseMessage[], charPerToken = 4): number {
  const chars = messages.reduce((n, m) => {
    const c = m.content;
    return n + (typeof c === "string" ? c.length : JSON.stringify(c).length);
  }, 0);
  return Math.ceil(chars / charPerToken);
}

function hasCredentials(config: AppConfig): boolean {
  const vars = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"];
  if (config.model.apiKeyEnv) vars.push(config.model.apiKeyEnv);
  if (config.model.authTokenEnv) vars.push(config.model.authTokenEnv);
  return vars.some((v) => Boolean(process.env[v]));
}

function messagesToText(messages: BaseMessage[]): string {
  return messages
    .map((m) => {
      const t = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `${m._getType()}: ${t}`;
    })
    .join("\n");
}

export async function compactHistory(
  messages: BaseMessage[],
  config: AppConfig
): Promise<BaseMessage[]> {
  const cc = config.compaction;
  if (!cc?.enabled || messages.length < 2) return messages;

  const total = estimateTokens(messages);
  const threshold = Math.floor(cc.contextWindow * cc.triggerThreshold);
  if (total <= threshold) return messages;

  log.info("compacting history", { beforeTokens: total, threshold });

  const recent = (await trimMessages(messages, {
    maxTokens: cc.keepRecentTokens,
    strategy: "last",
    tokenCounter: (msgs) => estimateTokens(msgs as BaseMessage[]),
    includeSystem: true,
  })) as BaseMessage[];

  const oldCount = messages.length - recent.length;
  if (oldCount <= 0) return recent;
  // oldMessages 排除 system（trimMessages includeSystem:true 已把 system 留在 recent 头，
  // 否则摘要它会在返回值里产出第二条 SystemMessage）
  const oldMessages = messages.slice(0, oldCount).filter((m) => m._getType() !== "system");

  if (!hasCredentials(config)) {
    log.warn("超阈值但无凭证 → 仅裁剪不摘要", { oldCount });
    return recent;
  }

  try {
    const raw = resolveModel(config);
    const model = raw && typeof raw !== "string" ? raw : null;
    if (!model) return recent;
    const res = await (
      model as unknown as {
        invoke: (m: BaseMessage[]) => Promise<{ content: unknown }>;
      }
    ).invoke([
      new SystemMessage("把以下对话历史压缩成简洁摘要，保留关键事实、决定与未决问题。只输出摘要正文。"),
      new HumanMessage(messagesToText(oldMessages)),
    ]);
    const summary = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
    log.info("history summarized", { afterTokens: estimateTokens(recent) + estimateTokens([new SystemMessage(summary)]) });
    return [new SystemMessage(`[会话历史摘要]\n${summary}`), ...recent];
  } catch (err) {
    log.warn("摘要失败 → 回退裁剪", { error: String(err) });
    return recent;
  }
}
