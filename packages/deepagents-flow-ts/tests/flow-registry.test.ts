/**
 * Flow 注册表回归 —— 守住内置 flow（尤其是迁入 app/flows 后的 dev-agent）。
 * 注册表漏项时 resolveFlow 只会 warn 并静默回落 default，运行期难以察觉。
 */
import { describe, expect, it } from "vitest";
import { flows, resolveFlow } from "../src/app/flows/index.js";

describe("flow registry", () => {
  it("内置 default / dev-agent 已注册且形态正确", () => {
    expect(flows.default?.kind).toBe("stateful-recipe");
    expect(flows.default?.conversational).toBe(true);

    expect(flows["dev-agent"]?.kind).toBe("stateful-custom");
    expect(flows["dev-agent"]?.createExecutor).toBeTypeOf("function");
    expect(flows["dev-agent"]?.getTopology).toBeTypeOf("function");
  });

  it('resolveFlow("dev-agent") 不回落 default', () => {
    const def = resolveFlow("dev-agent");
    expect(def.name).toBe("dev-agent");
    expect(def.kind).toBe("stateful-custom");
  });

  it("未知 activeFlow 回落 default（不抛错）", () => {
    const def = resolveFlow("no-such-flow");
    expect(def.name).toBe("default");
  });
});
