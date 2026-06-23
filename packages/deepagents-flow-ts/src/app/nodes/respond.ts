/**
 * respond 节点 —— 取最后 AIMessage 文本写入 output（供非流式 surface / state 终态）。
 *
 * 默认图的收尾节点：think 决定「直接回答」时路由到此（无 tool_calls 分支）。
 *
 * 注意：**不再在此 onToken**。回答的流式 token 由 think 节点的 LLM 调用经 graph.stream
 * 的 messages 模式逐个透出（think 在 STREAM_TEXT_NODES 白名单）；若此处再整段 onToken 会与
 * 流式重复。仅设 output 兜底（surface 在未收到任何流式 token 时回退整段发，见 acp/server.ts）。
 */

import type { FlowState } from "../state.js";
import { extractText } from "../../libs/nodes/index.js";

export interface RespondNodeDeps {
  /** 保留入参以兼容现有图装配；本节点不再消费 callbacks（流式走 think + messages 模式）。 */
  callbacks?: unknown;
}

/** 创建 respond 节点：把最后一条 AIMessage 文本写入 output（不再 onToken）。 */
export function createRespondNode(_deps: RespondNodeDeps = {}) {
  return async (state: FlowState): Promise<Partial<FlowState>> => {
    const last = state.messages[state.messages.length - 1];
    // content 可能是 string 或 content block 数组（Anthropic 协议 / 部分 provider），
    // 统一经 extractText 抽纯文本，避免 array content 被当成空串导致无输出。
    const text = last ? extractText(last.content) : "";
    return { output: text, steps: ["respond"] };
  };
}
