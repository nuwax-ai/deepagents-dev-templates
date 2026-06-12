/**
 * prepare 节点 —— 预处理 / 规范化输入。
 * 占位实现：trim 输入并初始化 steps。把你的预处理逻辑放这里。
 */

import type { FlowState } from "../state.js";

export function prepareNode(state: FlowState): Partial<FlowState> {
  const input = state.input.trim();
  return { steps: [`prepared: ${input}`] };
}
