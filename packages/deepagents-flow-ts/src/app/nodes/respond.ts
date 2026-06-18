/**
 * respond 节点 —— 取最后 AIMessage 文本，经 onToken 流式发 + 设 output。
 *
 * 默认图的收尾节点：think 决定「直接回答」时路由到此（无 tool_calls 分支）。
 */

import type { FlowState } from "../state.js";
import type { FlowCallbacks } from "../../core/flow-types.js";
import { extractText } from "../../libs/nodes/index.js";

export interface RespondNodeDeps {
  /** surface 回调（流式 token）。 */
  callbacks?: FlowCallbacks;
}

/** 创建 respond 节点：把最后一条 AIMessage 文本经 onToken 流式发出并写入 output。 */
export function createRespondNode(deps: RespondNodeDeps) {
  const { callbacks } = deps;

  return async (state: FlowState): Promise<Partial<FlowState>> => {
    const last = state.messages[state.messages.length - 1];
    // content 可能是 string 或 content block 数组（Anthropic 协议 / 部分 provider），
    // 统一经 extractText 抽纯文本，避免 array content 被当成空串导致无输出。
    const text = last ? extractText(last.content) : "";
    if (text && callbacks?.onToken) await callbacks.onToken(text);
    return { output: text, steps: ["respond"] };
  };
}
