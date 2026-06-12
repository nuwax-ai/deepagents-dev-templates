/**
 * respond 节点 —— 整理最终输出。
 * 占位实现：原样返回 act 的产出。把你的收尾 / 格式化放这里。
 */

import type { FlowState } from "../state.js";

export function respondNode(state: FlowState): Partial<FlowState> {
  return { output: state.output ?? "（无输出）" };
}
