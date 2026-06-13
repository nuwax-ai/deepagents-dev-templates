/**
 * 默认 flow 测试
 *  - routeAfterReflect：条件边决策表(纯函数,含边界)
 *  - executeFlow：真实编译图按 prepare→think→act→observe→reflect→…→respond 运行并收敛
 *    (无凭证 → 启发式 fallback:1 轮收敛,不依赖 LLM)
 *
 * executeFlow 用例强制无凭证(beforeAll 清掉 ANTHROPIC/OPENAI 凭证并赛后恢复),
 * 保证走 fallback 路径、结果确定(不受本机 .env 影响)。
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { routeAfterReflect, MAX_ITERS } from "../src/app/nodes/reflect.js";
import { executeFlow } from "../src/app/graph.js";
import type { FlowState } from "../src/app/state.js";

describe("routeAfterReflect (条件边)", () => {
  const s = (o: Partial<FlowState>): FlowState => ({ input: "x", ...o });

  it("continue 且未达上限 → think(再来一轮)", () => {
    expect(routeAfterReflect(s({ decision: "continue", attempts: 1 }))).toBe("think");
  });
  it("continue 恰好达到上限 → respond(防死循环)", () => {
    expect(
      routeAfterReflect(s({ decision: "continue", attempts: MAX_ITERS }))
    ).toBe("respond");
  });
  it("done → respond(无论 attempts)", () => {
    expect(routeAfterReflect(s({ decision: "done", attempts: 0 }))).toBe("respond");
  });
});

describe("executeFlow 默认图(无凭证 fallback)", () => {
  const credVars = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"];
  const saved: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const v of credVars) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });
  afterAll(() => {
    for (const v of credVars) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it("算术输入 → 走 calculate → 结果 14 流入 output,1 轮收敛", async () => {
    const res = await executeFlow("2 + 3 * 4");
    const calc = res.observations.find((o) => o.tool === "calculate");
    expect(calc).toBeTruthy();
    expect(calc?.result).toBe("14"); // 2 + 3*4 = 14
    expect(res.output).toContain("14");
    expect(res.steps.filter((s) => s.startsWith("think#")).length).toBe(1);
  });

  it("非算术输入 → 走 echo → 收敛", async () => {
    const res = await executeFlow("hello");
    expect(res.observations.some((o) => o.tool === "echo")).toBe(true);
    expect(res.steps.filter((s) => s.startsWith("think#")).length).toBe(1);
  });
});
