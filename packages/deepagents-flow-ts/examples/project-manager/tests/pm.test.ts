/**
 * 项目管理 flow 测试。
 *  - 纯函数（无凭证、确定性）：routeAfterEvaluate —— 守住评估循环条件边 + MAX_REPLAN 封顶（防死循环）。
 *  - 真实接入（skipIf 无凭证）：plan/estimate/evaluate/finalize 真调 LLM，验证 reflection 循环 + HITL 审批闭环。
 */

import { config as loadDotenv } from "dotenv";
loadDotenv();

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createPMFlow,
  routeAfterEvaluate,
  MAX_REPLAN,
  type PMStateType,
} from "../graph.js";
import { loadFlowConfig } from "../../../src/runtime/config.js";

const hasCreds = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"].some(
  (k) => Boolean(process.env[k])
);

describe("routeAfterEvaluate (条件边, 纯函数, 无凭证)", () => {
  const s = (o: Partial<PMStateType>): PMStateType => ({
    goal: "x",
    tasks: [],
    decision: "",
    critique: "",
    attempts: 0,
    feedback: "",
    output: "",
    ...o,
  });
  it("incomplete & 未达上限 → plan(重规划)", () => {
    expect(routeAfterEvaluate(s({ decision: "incomplete", attempts: 1 }))).toBe(
      "plan"
    );
  });
  it("incomplete & 达上限 → approve(防死循环)", () => {
    expect(
      routeAfterEvaluate(s({ decision: "incomplete", attempts: MAX_REPLAN }))
    ).toBe("approve");
  });
  it("complete → approve", () => {
    expect(routeAfterEvaluate(s({ decision: "complete", attempts: 1 }))).toBe(
      "approve"
    );
  });
});

describe.skipIf(!hasCreds)("project-manager flow (真实 LLM 评估循环 + HITL)", () => {
  const { appConfig } = loadFlowConfig();

  it("拆解 → 估时 → 评估 → interrupt 出计划", async () => {
    const flow = createPMFlow(appConfig);
    const res = await flow.run({ query: "做一个产品落地页" }, randomUUID());
    expect(res.status).toBe("interrupted");
    if (res.status === "interrupted") expect(res.question).toContain("项目计划");
  }, 90000);

  it("resume 'ok' → 批准 + 甘特排期", async () => {
    const flow = createPMFlow(appConfig);
    const tid = randomUUID();
    const first = await flow.run({ query: "做一个产品落地页" }, tid);
    expect(first.status).toBe("interrupted");
    const done = await flow.run({ resume: "ok" }, tid);
    expect(done.status).toBe("done");
    if (done.status === "done") {
      expect(done.answer).toContain("已批准");
      expect(done.answer).toContain("排期");
    }
  }, 90000);
});
