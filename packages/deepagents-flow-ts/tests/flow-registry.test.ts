/**
 * Flow 注册表回归 —— 内置仅 default；未知 active 直接抛错。
 */
import { describe, expect, it } from "vitest";
import { flows, resolveFlow } from "../src/app/flows/index.js";

describe("flow registry", () => {
  it("仅注册 default 且为 conversational stateful-recipe", () => {
    expect(Object.keys(flows)).toEqual(["default"]);
    expect(flows.default?.kind).toBe("stateful-recipe");
    expect(flows.default?.conversational).toBe(true);
    expect(flows.default?.profile.interaction).toBe("chat");
  });

  it("未知 flow.active 直接抛错（不回落 default）", () => {
    expect(() => resolveFlow("no-such-flow")).toThrow(/仅允许 "default"/);
  });
});
