/**
 * respond 节点 —— 取最后 AIMessage 文本，经 onToken 流式发 + 设 output。
 *
 * 默认图的收尾节点：think 决定「直接回答」时路由到此（无 tool_calls 分支）。
 */

import type { FlowState } from "../state.js";
import type { FlowCallbacks } from "../../core/flow-types.js";

export interface RespondNodeDeps {
  /** surface 回调（流式 token）。 */
  callbacks?: FlowCallbacks;
}

/** 创建 respond 节点：把最后一条 AIMessage 文本经 onToken 流式发出并写入 output。 */
export function createRespondNode(deps: RespondNodeDeps) {
  const { callbacks } = deps;

  return async (state: FlowState): Promise<Partial<FlowState>> => {
    const last = state.messages[state.messages.length - 1];
    const text = last && typeof last.content === "string" ? (last.content as string) : "";
    if (text && callbacks?.onToken) await callbacks.onToken(text);
    return { output: text, steps: ["respond"] };
  };
}
