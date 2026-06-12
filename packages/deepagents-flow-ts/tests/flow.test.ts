/**
 * 默认占位 flow 测试
 *  - routeAfterDecide：条件边决策表（纯函数）
 *  - executeFlow：真实编译图按 prepare→act→decide→(act)→respond 运行并收敛
 */

import { describe, it, expect } from "vitest";
import { routeAfterDecide, MAX_ACT_ATTEMPTS } from "../src/app/nodes/decide.js";
import { executeFlow } from "../src/app/graph.js";
import type { FlowState } from "../src/app/state.js";

describe("routeAfterDecide (条件边)", () => {
  const s = (o: Partial<FlowState>): FlowState => ({ input: "x", ...o });

  it("retry 且未达上限 → act（重试）", () => {
    expect(routeAfterDecide(s({ decision: "retry", attempts: 1 }))).toBe("act");
  });
  it("retry 且达到上限 → respond（防死循环）", () => {
    expect(
      routeAfterDecide(s({ decision: "retry", attempts: MAX_ACT_ATTEMPTS }))
    ).toBe("respond");
  });
  it("done → respond", () => {
    expect(routeAfterDecide(s({ decision: "done", attempts: 0 }))).toBe("respond");
  });
});

describe("executeFlow 默认占位图", () => {
  it("运行并收敛，产出非空 output", async () => {
    const res = await executeFlow("hello");
    expect(res.output.length).toBeGreaterThan(0);
    // decide 占位恒 retry，attempts 封顶 → act 恰好执行 MAX_ACT_ATTEMPTS 轮
    const actSteps = res.steps.filter((step) => step.startsWith("act#"));
    expect(actSteps.length).toBe(MAX_ACT_ATTEMPTS);
  });
});
