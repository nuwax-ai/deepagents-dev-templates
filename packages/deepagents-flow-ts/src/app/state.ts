/**
 * 默认 flow 的状态(图的 channels)。通用骨架,演示常见的 state 形态:
 *  - input / history:输入
 *  - attempts / decision:编排控制(条件边用)
 *  - plan:当前轮 plan 节点选定的下一步(每轮覆写)
 *  - pendingResult:act 产出、observe 消费的瞬态(每轮清)
 *  - observations[]:跨轮累积的工具结果(observe 节点 append)
 *  - steps[]:人类可读轨迹(便于测试 / 展示)
 *  - output:最终回答
 *
 * ⚠️ LangGraph 限制:channel 名不能和节点名相同 → 判定字段叫 `decision`,判定节点叫 `reflect`。
 * 想加自己的字段?在下面加即可;图里用 `Annotation` 声明同名 channel(见 graph.ts)。
 */

import { BaseMessage } from "@langchain/core/messages";

/** 一次工具调用结果(think → act 产出、observe 累积)。 */
export interface Observation {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

/** plan 节点选定的下一步 action。 */
export interface PlanStep {
  tool: string;
  args: Record<string, unknown>;
  reason?: string;
}

export interface FlowState {
  /** 输入 */
  input: string;
  history?: BaseMessage[];

  /** 编排控制(条件边) */
  attempts?: number; // 已完成的迭代轮次
  decision?: string; // reflect 判定："continue" | "done"

  /** plan / act / observe */
  plan?: PlanStep | null; // 当前轮的下一步
  pendingResult?: Observation | null; // act 产出、observe 消费(瞬态)
  observations?: Observation[]; // 跨轮累积

  /** 轨迹 / 输出 */
  steps?: string[];
  output?: string;
}
