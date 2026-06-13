/**
 * 节点纯函数单测 —— 覆盖图级集成测不到的解析 / 安全分支。
 *
 *  - runDemoTool / safeCalc：工具执行 + 算术注入边界(safeCalc 用 Function(),安全攸关)
 *  - safeParsePlan：think 的 plan JSON 解析(只认已知 tool + 合法 args)
 *  - parseDecision：reflect 的判定解析(只认 JSON 里的 continue,不被散文误判)
 *  - chunkToText：respond 的 content block → 纯文本归一
 */

import { describe, it, expect } from "vitest";
import { runDemoTool } from "../src/app/nodes/tools.js";
import { safeParsePlan } from "../src/app/nodes/think.js";
import { parseDecision } from "../src/app/nodes/reflect.js";
import { chunkToText } from "../src/app/nodes/respond.js";

describe("runDemoTool / safeCalc", () => {
  it("calculate 遵循运算优先级", () => {
    expect(runDemoTool("calculate", { expression: "2 + 3 * 4" })).toBe("14");
    expect(runDemoTool("calculate", { expression: "(2 + 3) * 4" })).toBe("20");
    expect(runDemoTool("calculate", { expression: "10 / 2" })).toBe("5");
  });

  it("calculate 拒绝注入 / 非法字符(只允许数字与运算符)", () => {
    expect(() => runDemoTool("calculate", { expression: "process.exit(1)" })).toThrow();
    expect(() => runDemoTool("calculate", { expression: "1; console.log(1)" })).toThrow();
    expect(() => runDemoTool("calculate", { expression: "globalThis" })).toThrow();
    expect(() => runDemoTool("calculate", { expression: "" })).toThrow();
  });

  it("calculate 拒绝非有限结果(如除零)", () => {
    expect(() => runDemoTool("calculate", { expression: "1/0" })).toThrow();
  });

  it("echo 回显 text,缺省回退 value / 空串", () => {
    expect(runDemoTool("echo", { text: "hi" })).toBe("hi");
    expect(runDemoTool("echo", { value: "x" })).toBe("x");
    expect(runDemoTool("echo", {})).toBe("");
  });

  it("time 返回 ISO 时间串", () => {
    expect(runDemoTool("time", {})).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("未知工具抛错", () => {
    expect(() => runDemoTool("nope", {})).toThrow(/unknown tool/);
  });
});

describe("safeParsePlan (think)", () => {
  it("合法结构 → 解析", () => {
    expect(safeParsePlan('{"tool":"echo","args":{"text":"x"},"reason":"r"}')).toEqual({
      tool: "echo",
      args: { text: "x" },
      reason: "r",
    });
  });

  it("无 reason → reason 为 undefined", () => {
    expect(safeParsePlan('{"tool":"time","args":{}}')).toEqual({
      tool: "time",
      args: {},
      reason: undefined,
    });
  });

  it("未知 tool → null(走 fallback)", () => {
    expect(safeParsePlan('{"tool":"rm","args":{}}')).toBeNull();
  });

  it("args 非对象 / 缺失 → null", () => {
    expect(safeParsePlan('{"tool":"echo","args":"x"}')).toBeNull();
    expect(safeParsePlan('{"tool":"echo"}')).toBeNull();
  });

  it("非法 JSON → null", () => {
    expect(safeParsePlan("not json")).toBeNull();
    expect(safeParsePlan("{broken")).toBeNull();
  });
});

describe("parseDecision (reflect)", () => {
  it("JSON continue / done", () => {
    expect(parseDecision('{"decision":"continue"}')).toBe("continue");
    expect(parseDecision('{"decision":"done"}')).toBe("done");
  });

  it("从夹杂文本里提取 JSON", () => {
    expect(parseDecision('思考后:{"decision":"continue"}')).toBe("continue");
  });

  it("散文里出现 continue 字样但无 JSON → done(不误判)", () => {
    expect(parseDecision("我觉得可以 continue 再查一次")).toBe("done");
  });

  it("无 JSON / 非法 / 未知值 → done(安全收敛)", () => {
    expect(parseDecision("no json here")).toBe("done");
    expect(parseDecision("{broken")).toBe("done");
    expect(parseDecision('{"decision":"maybe"}')).toBe("done");
  });
});

describe("chunkToText (respond)", () => {
  it("字符串原样返回", () => {
    expect(chunkToText("hello")).toBe("hello");
  });

  it("content block 数组拼接 text", () => {
    expect(
      chunkToText([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ])
    ).toBe("ab");
  });

  it("数组里无 text 的 block 视为空串", () => {
    expect(chunkToText([{ text: "a" }, { foo: 1 }])).toBe("a");
  });

  it("非字符串 / 非数组 → 空串", () => {
    expect(chunkToText(123)).toBe("");
    expect(chunkToText(null)).toBe("");
    expect(chunkToText({})).toBe("");
  });
});
