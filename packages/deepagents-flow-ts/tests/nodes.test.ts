/**
 * 节点 / 工具纯函数单测 —— 覆盖图级集成测不到的解析 / 安全分支。
 *
 *  - safeCalc：demo calculate 的算术求值注入边界（用 Function()，安全攸关）
 *  - createDemoTools：demo 工具注册成 StructuredTool 后可 invoke
 *  - sandbox：路径权限校验（read-only 拒写 / denied 拒 / 越界拒）
 */

import { describe, it, expect } from "vitest";
import { safeCalc, createDemoTools } from "../src/app/tools/demo.tool.js";
import { getFlowSandboxPolicy, isPathAllowed } from "../src/runtime/fs/sandbox.js";
import type { AppConfig } from "../src/runtime/index.js";

describe("safeCalc (demo calculate)", () => {
  it("遵循运算优先级", () => {
    expect(safeCalc("2 + 3 * 4")).toBe("14");
    expect(safeCalc("(2 + 3) * 4")).toBe("20");
    expect(safeCalc("10 / 2")).toBe("5");
  });

  it("拒绝注入 / 非法字符", () => {
    expect(() => safeCalc("process.exit(1)")).toThrow();
    expect(() => safeCalc("1; console.log(1)")).toThrow();
    expect(() => safeCalc("globalThis")).toThrow();
    expect(() => safeCalc("")).toThrow();
  });

  it("拒绝非有限结果（如除零）", () => {
    expect(() => safeCalc("1/0")).toThrow();
  });
});

describe("createDemoTools", () => {
  const tools = createDemoTools();
  const byName = (n: string) => tools.find((t) => t.name === n)!;

  it("echo 回显", async () => {
    expect(String((await byName("echo").invoke({ text: "hi" })).valueOf())).toBe("hi");
  });

  it("calculate 走 safeCalc", async () => {
    expect(String((await byName("calculate").invoke({ expression: "2 + 3 * 4" })).valueOf())).toBe(
      "14"
    );
  });

  it("time 返回 ISO 时间串", async () => {
    expect(String((await byName("time").invoke({})).valueOf())).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("sandbox isPathAllowed", () => {
  const config = {
    permissions: { mode: "ask", interruptOn: [], allowedPaths: ["src/app/"], deniedPaths: ["src/runtime/"] },
    sandbox: { profile: "workspace-write", writablePaths: ["src/app/"], deniedWritePaths: ["src/runtime/"], environment: { allowedEnv: [], secretEnv: [] } },
  } as unknown as AppConfig;
  const policy = getFlowSandboxPolicy(config);
  const root = "/Users/test/proj";

  it("read-only profile 拒绝写", () => {
    const ro = { ...policy, profile: "read-only" as const };
    expect(isPathAllowed(`${root}/src/app/a.ts`, root, ro, true).ok).toBe(false);
  });

  it("denied 路径拒绝写", () => {
    expect(isPathAllowed(`${root}/src/runtime/x.ts`, root, policy, true).ok).toBe(false);
  });

  it("workspace 越界拒绝", () => {
    expect(isPathAllowed(`/etc/passwd`, root, policy, false).ok).toBe(false);
  });

  it("allowed 内放行读", () => {
    expect(isPathAllowed(`${root}/src/app/a.ts`, root, policy, false).ok).toBe(true);
  });
});
