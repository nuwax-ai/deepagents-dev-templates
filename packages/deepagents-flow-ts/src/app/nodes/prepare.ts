/**
 * prepare 节点 ——【模式:纯逻辑节点 + state 初始化】。
 *
 * 不调 LLM / 工具,只规范化输入、把编排 state 播种成干净初值。
 * 模板里这类节点用于:预处理、参数校验、默认值填充、状态播种。
 * 想做输入归一化 / 语言检测 / 历史裁剪?放这里。
 */

import type { FlowState } from "../state.js";

export function prepareNode(state: FlowState): Partial<FlowState> {
  const input = state.input.trim();
  return {
    input,
    attempts: 0,
    decision: undefined,
    plan: null,
    pendingResult: null,
    observations: [],
    steps: [`prepare: "${input}"`],
  };
}
