/**
 * 人审 flow 测试 —— 守住 StatefulFlow(HITL) 的 interrupt → resume 闭环 + checkpointer 隔离。
 * 全程无凭证(节点纯模板),结果确定。
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createReviewFlow } from "../graph.js";

describe("human-in-loop review flow", () => {
  it("首跑到 interrupt：返回带草稿的问题", async () => {
    const flow = createReviewFlow();
    const res = await flow.run({ query: "写产品介绍" }, randomUUID());
    expect(res.status).toBe("interrupted");
    if (res.status === "interrupted") {
      expect(res.question).toContain("草稿");
      expect(res.question).toContain("写产品介绍");
    }
  });

  it("resume 'ok' → 通过定稿（同一 threadId 续接草稿）", async () => {
    const flow = createReviewFlow();
    const tid = randomUUID();
    const first = await flow.run({ query: "写产品介绍" }, tid);
    expect(first.status).toBe("interrupted");
    const done = await flow.run({ resume: "ok" }, tid);
    expect(done.status).toBe("done");
    if (done.status === "done") {
      expect(done.answer).toContain("已通过");
      expect(done.answer).toContain("写产品介绍"); // 草稿被 checkpointer 保留
    }
  });

  it("resume 给意见 → 修订定稿并并入意见", async () => {
    const flow = createReviewFlow();
    const tid = randomUUID();
    await flow.run({ query: "写产品介绍" }, tid);
    const done = await flow.run({ resume: "改短一点" }, tid);
    expect(done.status).toBe("done");
    if (done.status === "done") {
      expect(done.answer).toContain("已按意见修订");
      expect(done.answer).toContain("改短一点");
    }
  });

  it("不同 threadId 互不串状态", async () => {
    const flow = createReviewFlow();
    const a = randomUUID();
    const b = randomUUID();
    await flow.run({ query: "任务A" }, a);
    await flow.run({ query: "任务B" }, b);
    const doneA = await flow.run({ resume: "ok" }, a);
    expect(doneA.status).toBe("done");
    if (doneA.status === "done") expect(doneA.answer).toContain("任务A");
  });
});
