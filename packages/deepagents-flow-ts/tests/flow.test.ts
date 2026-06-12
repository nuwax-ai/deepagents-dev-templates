/**
 * 默认 flow 测试
 *  - routeAfterReflect：条件边决策表(纯函数)
 *  - executeFlow：真实编译图按 prepare→plan→act→observe→reflect→…→respond 运行并收敛
 *    (无凭证 → 启发式 fallback:1 轮收敛,不依赖 LLM)
 */

import { describe, it, expect } from "vitest";
import { routeAfterReflect, MAX_ITERS } from "../src/app/nodes/reflect.js";
import { executeFlow } from "../src/app/graph.js";
import type { FlowState } from "../src/app/state.js";

describe("routeAfterReflect (条件边)", () => {
  const s = (o: Partial<FlowState>): FlowState => ({ input: "x", ...o });

  it("continue 且未达上限 → think(再来一轮)", () => {
    expect(routeAfterReflect(s({ decision: "continue", attempts: 1 }))).toBe("think");
  });
  it("continue 且达上限 → respond(防死循环)", () => {
    expect(routeAfterReflect(s({ decision: "continue", attempts: MAX_ITERS }))).toBe(
      "respond"
    );
  });
  it("done → respond", () => {
    expect(routeAfterReflect(s({ decision: "done", attempts: 0 }))).toBe("respond");
  });
});

describe("executeFlow 默认图(无凭证 fallback)", () => {
  it("算术输入 → 走 calculate 工具 → 收敛、产出非空 output", async () => {
    const res = await executeFlow("2 + 3 * 4");
    expect(res.output.length).toBeGreaterThan(0);
    expect(res.observations.some((o) => o.tool === "calculate")).toBe(true);
    // fallback 下 reflect 一轮即收敛
    const planSteps = res.steps.filter((step) => step.startsWith("think#"));
    expect(planSteps.length).toBe(1);
  });

  it("非算术输入 → 走 echo 工具 → 收敛", async () => {
    const res = await executeFlow("hello");
    expect(res.observations.some((o) => o.tool === "echo")).toBe(true);
    const planSteps = res.steps.filter((step) => step.startsWith("think#"));
    expect(planSteps.length).toBeLessThanOrEqual(MAX_ITERS);
  });
});
