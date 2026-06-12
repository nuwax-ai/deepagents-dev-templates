/**
 * act 节点 —— 执行一步"工作"。
 * 占位实现：回显输入。真实场景在这里调用 LLM / 工具 / 检索。
 * 每次执行 attempts +1，供 decide 的条件边判断是否还能重试。
 */

import type { FlowState } from "../state.js";

export function actNode(state: FlowState): Partial<FlowState> {
  const attempts = (state.attempts ?? 0) + 1;
  const steps = [...(state.steps ?? []), `act#${attempts}: handled "${state.input}"`];
  // 占位输出 —— 替换为你的核心逻辑产出
  const output = `（占位回答）已处理：${state.input}`;
  return { attempts, steps, output };
}
