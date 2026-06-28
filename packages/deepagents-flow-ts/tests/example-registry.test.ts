import { describe, expect, it } from "vitest";
import {
  buildExampleArgv,
  listExamples,
  resolveExample,
} from "../scripts/lib/example-registry.mjs";

describe("example-registry", () => {
  it("resolveExample 解析短别名与目录名", () => {
    expect(resolveExample("rag")?.entry).toBe("examples/rag/index.ts");
    expect(resolveExample("travel-planner")?.key).toBe("travel");
    expect(resolveExample("human-in-loop")?.key).toBe("review");
    expect(resolveExample("unknown")).toBeNull();
  });

  it("buildExampleArgv 有 query 或 -i 时插入 CLI 子命令", () => {
    expect(buildExampleArgv("rag", ["什么是 LangGraph？"])).toEqual(["rag", "什么是 LangGraph？"]);
    expect(buildExampleArgv("rag", ["-i"])).toEqual(["rag", "-i"]);
    expect(buildExampleArgv("rag", [])).toEqual([]);
    expect(buildExampleArgv(null, ["query", "-i"])).toEqual(["query", "-i"]);
  });

  it("listExamples 覆盖全部注册范例", () => {
    const names = listExamples().map((e) => e.name);
    expect(names).toContain("rag");
    expect(names).toContain("dev-agent");
    expect(names.length).toBe(6);
  });
});
