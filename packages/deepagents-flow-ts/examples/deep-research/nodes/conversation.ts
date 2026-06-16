/** 报告完成后的持续会话节点。 */

import { interrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "../../../src/runtime/index.js";
import { isApproval, requireModel } from "../../shared.js";
import type { ResearchStateShape } from "./types.js";
import { langClause, llmLongTimeout, streamLLMText } from "./helpers.js";

const log = logger.child("deep-research");

/** 收尾信号：空 / 通过类词 / 明确「结束」类词 → 结束持续会话、定稿。 */
const END_RE = /^(结束|完成|done|搞定|收工|没了|不用了|就这样)$/i;
export function isEndSignal(msg: string): boolean {
  return isApproval(msg) || END_RE.test(msg.trim());
}

/**
 * converse：interrupt —— 报告完成后进入【持续会话】。
 * 展示当前报告（首轮）或上一轮回应（后续轮），收集用户下一条消息。
 */
export function converseNode(state: ResearchStateShape): Partial<ResearchStateShape> {
  const isFirst = state.conversation.length === 0;
  const current = state.lastAnswer || state.finalReport || state.draft;
  const currentWasStreamed = isFirst ? state.draftStreamed : state.lastAnswerStreamed;
  const feedback = interrupt({
    question: currentWasStreamed
      ? `${isFirst ? `📄 研究报告（${state.refinedTopic}）已生成。` : "已回应。"}\n\n---\n` +
        `还需要什么？（继续修改/提问，或回复「结束」收尾）`
      : isFirst
      ? `📄 研究报告（${state.refinedTopic}）：\n\n${current}\n\n---\n` +
        `报告已生成。可就这份研究继续：要改哪段、补充什么、或直接提问；回复「结束」收尾定稿。`
      : `${current}\n\n---\n还需要什么？（继续修改/提问，或回复「结束」收尾）`,
  });
  const msg = String(feedback ?? "").trim();
  return { userMessage: msg, conversation: [{ role: "user", content: msg }] };
}

/** 路由（纯函数，导出供单测）：用户收尾 → delivery 定稿；否则 → respond 持续会话。 */
export function routeAfterConverse(state: ResearchStateShape): "respond" | "wrapup" {
  return isEndSignal(state.userMessage) ? "wrapup" : "respond";
}

/**
 * respond：用累积的研究上下文（findings + 当前报告 + 对话历史）回应用户最新消息。
 * 修改/补充类 → 输出修订后的完整报告（更新 finalReport）；提问类 → 直接作答。
 */
export async function respondNode(
  state: ResearchStateShape,
  appConfig?: AppConfig,
  config?: LangGraphRunnableConfig
): Promise<Partial<ResearchStateShape>> {
  const model = requireModel(appConfig, "deep-research 示例");
  const findingsSummary = state.findings
    .map((f) => `## ${f.title}\n${f.summary}`)
    .join("\n\n");
  // converseNode 已把当前用户消息追加进 conversation，而 prompt 末尾会单独放 userMessage，
  // 排除最后一条（当前轮用户消息）避免在 prompt 里重复出现。
  const convo = state.conversation
    .slice(0, -1)
    .slice(-6)
    .map((t) => `${t.role === "user" ? "用户" : "助手"}：${t.content}`)
    .join("\n");
  const current = state.finalReport || state.draft;
  const streamed = await streamLLMText(model, [
    new SystemMessage(
      `你在就一份研究报告与用户持续对话。依据【研究资料】与【当前报告】回应用户最新消息：\n` +
        `- 若要求修改/补充报告 → 输出修订后的【完整报告】（Markdown，保持原结构与语境）；\n` +
        `- 若是提问 → 直接简洁作答，不必重发报告。\n只输出正文。` +
        langClause(state.languageHint)
    ),
    new HumanMessage(
      `主题：${state.refinedTopic}\n\n【研究资料】\n${findingsSummary}\n\n【当前报告】\n${current}\n\n【对话】\n${convo}\n\n用户最新消息：${state.userMessage}`
    ),
  ], appConfig, config, llmLongTimeout(appConfig));
  const answer = streamed.text.trim();
  const looksLikeReport = answer.length > 800 && /(^|\n)#{1,3}\s/.test(answer);
  log.info("respond", { revised: looksLikeReport, answerLen: answer.length });
  return {
    ...(looksLikeReport ? { finalReport: answer } : {}),
    lastAnswer: answer,
    lastAnswerStreamed: streamed.streamed,
    conversation: [{ role: "assistant", content: answer }],
  };
}
