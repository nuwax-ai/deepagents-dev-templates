/**
 * observe 节点 ——【模式:state 转换 / 累积节点】。
 *
 * 不调外部;把 act 产出的 pendingResult append 进 observations[],并清掉瞬态。
 * 演示「跨轮累积中间结果」的常见模式:顺序流里手动 append 即可;
 * 当需要并行 fan-out(多分支同时写同一 channel)时,改用 Annotation 的 reducer —— 见
 * docs/flow-patterns.md 的「Send 并行 + reducer」一节。
 */

import type { FlowState } from "../state.js";

export function observeNode(state: FlowState): Partial<FlowState> {
  const observations = [...(state.observations ?? [])];
  if (state.pendingResult) {
    observations.push(state.pendingResult);
  }
  return {
    observations,
    pendingResult: null,
    steps: state.pendingResult
      ? [...(state.steps ?? []), `observe: 共 ${observations.length} 条观察`]
      : (state.steps ?? []),
  };
}
