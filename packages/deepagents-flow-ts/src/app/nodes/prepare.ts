/**
 * prepare 节点 —— 首次把 input 转 HumanMessage 加入 messages（历史由 checkpointer 恢复）。
 *
 * 纯节点（无运行时依赖）：故直接导出节点函数，不走工厂。
 * 多轮上下文压缩见 examples/dev-agent（compactHistory + updateState + RemoveMessage 替换模式）。
 */

import { HumanMessage } from "@langchain/core/messages";
import type { FlowState } from "../state.js";

export const prepareNode = async (state: FlowState): Promise<Partial<FlowState>> => {
  if (!state.input) return {};
  return { messages: [new HumanMessage(state.input)] };
};
