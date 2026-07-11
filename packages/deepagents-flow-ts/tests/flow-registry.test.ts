/**
 * Flow 注册表回归 —— 内置仅 default；未知 active 回落 default。
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

  it("未知 flow.active 回落 default（不抛错）", () => {
    const def = resolveFlow("no-such-flow");
    expect(def.name).toBe("default");
  });
});
