/**
 * LLM 韧性原语单测（超时 / 重试 / 并发闸门 / config 解析）
 */

import { describe, it, expect, vi } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { AppConfigSchema } from "../src/runtime/index.js";
import {
  withTimeout,
  withRetry,
  createConcurrencyLimiter,
  resolveLlmResilience,
  invokeWithResilience,
} from "../src/runtime/services/llm-resilience.js";

describe("resolveLlmResilience", () => {
  it("默认短/长超时与并发", () => {
    const r = resolveLlmResilience();
    expect(r.shortTimeoutMs).toBe(120_000);
    expect(r.longTimeoutMs).toBe(180_000);
    expect(r.maxConcurrent).toBe(2);
  });

  it("config.model.settings 覆盖默认值", () => {
    const config = AppConfigSchema.parse({
      model: {
        settings: {
          invokeTimeoutMs: 90_000,
          invokeLongTimeoutMs: 200_000,
          maxConcurrentInvokes: 3,
        },
      },
    });
    const r = resolveLlmResilience(config);
    expect(r.shortTimeoutMs).toBe(90_000);
    expect(r.longTimeoutMs).toBe(200_000);
    expect(r.maxConcurrent).toBe(3);
  });
});

describe("withTimeout", () => {
  it("未超时则返回结果", async () => {
    await expect(withTimeout(Promise.resolve(42), 500, "测试")).resolves.toBe(42);
  });

  it("超时则 reject", async () => {
    await expect(
      withTimeout(new Promise(() => undefined), 30, "测试")
    ).rejects.toThrow("测试超时（30ms）");
  });
});

describe("withRetry", () => {
  it("第二次成功则返回", async () => {
    let n = 0;
    const v = await withRetry(
      async () => {
        n++;
        if (n < 2) throw new Error("flaky");
        return "ok";
      },
      { attempts: 3, baseDelayMs: 1, label: "t" }
    );
    expect(v).toBe("ok");
    expect(n).toBe(2);
  });
});

describe("createConcurrencyLimiter", () => {
  it("限制最大并发", async () => {
    const limit = createConcurrencyLimiter(2);
    let peak = 0;
    let active = 0;
    const task = () =>
      limit(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
      });
    await Promise.all([task(), task(), task(), task()]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("invokeWithResilience", () => {
  it("经 model.invoke 返回内容", async () => {
    const model = {
      invoke: vi.fn().mockResolvedValue({ content: "hi" }),
    };
    const res = await invokeWithResilience(model, [new HumanMessage("x")], {
      timeoutMs: 1000,
      attempts: 1,
    });
    expect(res.content).toBe("hi");
    expect(model.invoke).toHaveBeenCalledOnce();
  });
});
