/**
 * 人审 flow 测试。
 *  - 纯函数（无凭证、确定性）：isApproval —— 守住「通过」判定（含「不可以」不误判）。
 *  - 真实接入（skipIf 无凭证）：compose/finalize 真调 LLM，验证 interrupt→resume 闭环与 checkpointer 隔离。
 */

import { config as loadDotenv } from "dotenv";
loadDotenv();

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createReviewFlow } from "../graph.js";
import { loadFlowConfig } from "../../../src/runtime/config.js";
import { isApproval } from "../../shared.js";

const hasCreds = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"].some(
  (k) => Boolean(process.env[k])
);

describe("isApproval (纯函数, 无凭证)", () => {
  it("空回复 / 通过词 → 通过", () => {
    for (const fb of ["", "  ", "ok", "OK", "通过", "可以", "lgtm", "好的"]) {
      expect(isApproval(fb)).toBe(true);
    }
  });
  it("意见 / 否定 → 不通过", () => {
    for (const fb of ["改短一点", "不可以", "再加一段", "no"]) {
      expect(isApproval(fb)).toBe(false);
    }
  });
});

describe.skipIf(!hasCreds)("human-in-loop review flow (真实 LLM + HITL)", () => {
  const { appConfig } = loadFlowConfig();

  it("首跑到 interrupt：返回带草稿的问题", async () => {
    const flow = createReviewFlow(appConfig);
    const res = await flow.run({ query: "写一句产品介绍" }, randomUUID());
    expect(res.status).toBe("interrupted");
    if (res.status === "interrupted") expect(res.question).toContain("草稿");
  }, 60000);

  it("resume 'ok' → 通过定稿（同一 threadId 续接草稿）", async () => {
    const flow = createReviewFlow(appConfig);
    const tid = randomUUID();
    const first = await flow.run({ query: "写一句产品介绍" }, tid);
    expect(first.status).toBe("interrupted");
    const done = await flow.run({ resume: "ok" }, tid);
    expect(done.status).toBe("done");
    if (done.status === "done") expect(done.answer).toContain("已通过");
  }, 60000);

  it("不同 threadId 互不串状态", async () => {
    const flow = createReviewFlow(appConfig);
    const a = randomUUID();
    const b = randomUUID();
    await flow.run({ query: "写关于猫的一句话" }, a);
    await flow.run({ query: "写关于狗的一句话" }, b);
    const doneA = await flow.run({ resume: "ok" }, a);
    expect(doneA.status).toBe("done");
  }, 90000);
});
