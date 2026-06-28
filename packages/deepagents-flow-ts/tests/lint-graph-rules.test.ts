import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertGraphRules,
  lintGraphRules,
  routeConsumesParsed,
  writeConsumesParsed,
} from "../scripts/scaffold/lint-graph-rules.mjs";
import { parseSpec } from "../scripts/scaffold/schema.mjs";

const SPECS = resolve(import.meta.dirname, "../scripts/scaffold/specs");

function loadSpec(name: string) {
  return parseSpec(JSON.parse(readFileSync(resolve(SPECS, name), "utf-8")));
}

describe("lint-graph-rules R-G001", () => {
  it("writeConsumesParsed 识别 r.parsed 与解构", () => {
    expect(writeConsumesParsed("(r) => ({ x: r.parsed })")).toBe(true);
    expect(writeConsumesParsed("(r, s) => {\n  const p = (r.parsed ?? {})")).toBe(true);
    expect(writeConsumesParsed("(r) => { const { parsed } = r; return {} }")).toBe(true);
    expect(writeConsumesParsed("(_r) => ({ phase: 'parsed' })")).toBe(false);
    expect(writeConsumesParsed("(r) => ({ output: r.content })")).toBe(false);
  });

  it("routeConsumesParsed 要求 route 体含 parsed", () => {
    expect(routeConsumesParsed("(parsed) => ({ goto: 'x', update: { v: parsed } })")).toBe(true);
    expect(routeConsumesParsed("() => ({ goto: '__end__' })")).toBe(false);
  });

  it("示例 spec 均通过 R-G001", () => {
    for (const file of ["_example.interview-agent.flow.json", "_example.grade-redo.flow.json", "_example.router-gate.flow.json"]) {
      const spec = loadSpec(file);
      expect(lintGraphRules(spec).errors).toEqual([]);
    }
  });

  it("llm + parse 但 write 不读 parsed → 报错", () => {
    const spec = loadSpec("_example.interview-agent.flow.json");
    const bad = structuredClone(spec);
    bad.params.nodes.prepare.params.parse = "(t) => parseJson(t)";
    const { errors } = lintGraphRules(bad);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ rule: "R-G001", node: "prepare" });
    expect(() => assertGraphRules(bad)).toThrow(/R-G001/);
  });

  it("非 custom 拓扑跳过 lint", () => {
    const spec = loadSpec("_example.customer-support.flow.json");
    expect(spec.topology).toBe("react-tools");
    expect(lintGraphRules(spec).errors).toEqual([]);
  });

  it("节点名与 state channel 同名 → R-G007", () => {
    const spec = loadSpec("_example.interview-agent.flow.json");
    const bad = structuredClone(spec);
    bad.params.nodes.report = bad.params.nodes.writeReport;
    delete bad.params.nodes.writeReport;
    bad.params.edges = bad.params.edges.map((e: { from?: string; to?: string; targets?: string[]; condition?: string }) => {
      if (e.from === "writeReport") return { ...e, from: "report" };
      if (e.to === "writeReport") return { ...e, to: "report" };
      if (e.targets) {
        return {
          ...e,
          targets: e.targets.map((t) => (t === "writeReport" ? "report" : t)),
          condition: e.condition?.replace(/writeReport/g, "report"),
        };
      }
      return e;
    });
    const { errors } = lintGraphRules(bad);
    expect(errors.some((e) => e.rule === "R-G007" && e.node === "report")).toBe(true);
  });
});
