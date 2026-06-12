/**
 * decide 节点 + 条件路由 —— 工作流编排的核心展示点。
 *
 * decide 之后用 `addConditionalEdges` 在运行时决定走哪条边：
 * 需要再做一轮就回到 act，完成就去 respond。`attempts` 上限保证收敛。
 *
 * 占位策略恒返回 "retry" 以**演示**重试循环（默认会 act 两轮）；
 * 真实场景替换为你的判据（如输出质量评分、是否还有子任务）。
 */

import { logger } from "deepagents-app-ts/runtime";
import type { FlowState } from "../state.js";

const log = logger.child("flow-decide");

/** act 的最大轮次（首次 + 重试）。达到上限即放行到 respond，防死循环。 */
export const MAX_ACT_ATTEMPTS = 2;

export function decideNode(state: FlowState): Partial<FlowState> {
  log.info("decide", { attempts: state.attempts ?? 0 });
  // 占位：恒 "retry" 以演示条件边循环。换成你的判据。
  return { decision: "retry" };
}

/** 条件边：decide →（"act" 重试 | "respond" 收尾）。 */
export function routeAfterDecide(state: FlowState): "act" | "respond" {
  const attempts = state.attempts ?? 0;
  if (state.decision === "retry" && attempts < MAX_ACT_ATTEMPTS) {
    log.info("Routing back to act (retry)", { attempts });
    return "act";
  }
  log.info("Routing to respond", { attempts, decision: state.decision });
  return "respond";
}
