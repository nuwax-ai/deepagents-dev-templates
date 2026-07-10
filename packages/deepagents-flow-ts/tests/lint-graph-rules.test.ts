import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertGraphRules,
  lintGraphRules,
  routeConsumesParsed,
  writeConsumesParsed,
  writeUsesLlmContent,
  writeUsesStreamText,
} from "../scripts/scaffold/lint-graph-rules.mjs";
import { parseSpec } from "../scripts/scaffold/schema.mjs";
import * as customBlueprint from "../scripts/scaffold/blueprints/custom.mjs";

const SPECS = resolve(import.meta.dirname, "../scripts/scaffold/specs");

function loadSpec(name: string) {
  return parseSpec(JSON.parse(readFileSync(resolve(SPECS, name), "utf-8")));
}

describe("scaffold spec flow profile", () => {
  it("custom spec 必须声明 interaction 与 graphReason", () => {
    expect(() =>
      parseSpec({
        name: "missing-interaction",
        topology: "custom",
        params: {
          state: { query: { type: "string" }, output: { type: "string" } },
          nodes: {
            done: {
              type: "passthrough",
              params: { write: "() => ({ output: 'ok' })" },
            },
          },
          edges: [{ kind: "static", from: "__start__", to: "done" }],
          input: { queryField: "query" },
          result: { answerField: "output" },
        },
      })
    ).toThrow(/interaction|graphReason|custom topology/);
  });
});

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

  it("流式 custom 示例 spec 通过 R-G009", () => {
    for (const file of [
      "_example.translate-review.flow.json",
      "_example.multi-aspect-search.flow.json",
      "_example.router-gate.flow.json",
      "_example.interview-agent.flow.json",
    ]) {
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

describe("lint-graph-rules R-G009", () => {
  it("writeUsesStreamText / writeUsesLlmContent 识别 r.text 与 r.content", () => {
    expect(writeUsesStreamText("(r) => ({ draft: r.text.trim() })")).toBe(true);
    expect(writeUsesStreamText("(r) => ({ output: r.content })")).toBe(false);
    expect(writeUsesLlmContent("(r) => ({ draft: r.content })")).toBe(true);
    expect(writeUsesLlmContent("(r) => ({ draft: r.text })")).toBe(false);
  });

  it("llm-stream 使用 r.content → R-G009", () => {
    const spec = loadSpec("_example.multi-aspect-search.flow.json");
    const bad = structuredClone(spec);
    bad.params.nodes.aggregate.params.write = "(r) => ({ output: r.content })";
    const { errors } = lintGraphRules(bad);
    expect(errors.some((e) => e.rule === "R-G009" && e.node === "aggregate")).toBe(true);
  });

  it("approval-finalize.rejectedLlm 使用 r.content → R-G009", () => {
    const spec = loadSpec("_example.translate-review.flow.json");
    const bad = structuredClone(spec);
    bad.params.nodes.finalize.params.rejectedLlm.write =
      "(r) => ({ output: `✏️ 已按意见修订：${r.content}` })";
    const { errors } = lintGraphRules(bad);
    expect(errors.some((e) => e.rule === "R-G009" && e.node === "finalize")).toBe(true);
  });

  it("custom blueprint 渲染流式 spec 含 createLlmStreamNode 与 r.text", () => {
    for (const file of ["_example.translate-review.flow.json", "_example.router-gate.flow.json"]) {
      const spec = loadSpec(file);
      const files = customBlueprint.render(spec);
      const graph = files.find((f) => f.path.endsWith("graph.ts"))!.content;
      expect(graph).toContain("createLlmStreamNode");
      expect(graph).toContain("resolveLlmResilience");
      expect(graph).toContain("r.text");
    }
    const tr = customBlueprint.render(loadSpec("_example.translate-review.flow.json"));
    expect(tr.find((f) => f.path.endsWith("graph.ts"))!.content).not.toMatch(/rejectedLlm[\s\S]*r\.content/);
  });

  it("custom blueprint 支持 tool-exec 节点级工具绑定", () => {
    const spec = parseSpec({
      name: "tool-node-demo",
      description: "tool node binding demo",
      topology: "custom",
      interaction: "pipeline",
      graphReason: "需要固定的工具执行节点来验证 tool-exec 绑定。",
      tools: [{ builtin: "quote_price" }],
      params: {
        state: {
          messages: { type: "any-last" },
        },
        nodes: {
          retrieve: {
            type: "tool-exec",
            params: {
              tools: ["quote_price"],
            },
          },
        },
        edges: [{ kind: "static", from: "__start__", to: "retrieve" }, { kind: "static", from: "retrieve", to: "__end__" }],
        input: { queryField: "input" },
        result: { answerField: "output" },
      },
    });
    const files = customBlueprint.render(spec);
    const graph = files.find((f) => f.path.endsWith("graph.ts"))!.content;
    const index = files.find((f) => f.path.endsWith("index.ts"))!.content;

    expect(graph).toContain("createToolExecNode");
    expect(graph).toContain("pickTools(allTools, [\"quote_price\"])");
    expect(index).toContain("buildGraph(runtime.config, cp, runtime.allTools)");
    expect(index).toContain("export const platformToolRefs = JSON.parse(");
  });

  it("custom blueprint 支持 platform-tool 主动调用（按 toolName 定位工具）", () => {
    const spec = parseSpec({
      name: "platform-tool-demo",
      description: "platform tool action demo",
      topology: "custom",
      interaction: "pipeline",
      graphReason: "需要固定的平台工具节点来验证 toolName 主动调用。",
      tools: [
        {
          targetType: "Plugin",
          targetId: 309,
          name: "联网搜索",
          description: "在互联网上搜索相关信息",
          schema: {
            input: {
              type: "object",
              properties: {
                query: { type: "string" },
              },
            },
          },
        },
      ],
      params: {
        state: {
          query: { type: "string" },
          searchResult: { type: "any-last" },
        },
        nodes: {
          web_search: {
            type: "platform-tool",
            params: {
              toolName: "Plugin_309",
              args: "(s) => ({ query: s.query })",
              write: "(r) => ({ searchResult: r.raw })",
            },
          },
        },
        edges: [{ kind: "static", from: "__start__", to: "web_search" }, { kind: "static", from: "web_search", to: "__end__" }],
        input: { queryField: "query" },
        result: { answerField: "searchResult" },
      },
    });
    const files = customBlueprint.render(spec);
    const graph = files.find((f) => f.path.endsWith("graph.ts"))!.content;
    const index = files.find((f) => f.path.endsWith("index.ts"))!.content;

    expect(graph).toContain("createPlatformToolActionNode");
    expect(graph).toContain("tools: allTools");
    expect(graph).toContain("toolName: \"Plugin_309\"");
    expect(index).toContain("export const platformToolRefs = JSON.parse(");
    expect(index).toContain("targetId");
  });
});

describe("custom.resolveConversational", () => {
  it("无 approval 节点 → true（默认对话型，多轮不卡）", () => {
    const spec = parseSpec({
      name: "conv-demo",
      description: "",
      topology: "custom",
      interaction: "chat",
      graphReason: "测试 resolveConversational 的纯 LLM 对话 custom 场景。",
      params: {
        state: { out: { type: "any-last" } },
        nodes: { a: { type: "llm", params: { prompt: "()=>''", write: "(r)=>({})" } } },
        edges: [
          { kind: "static", from: "__start__", to: "a" },
          { kind: "static", from: "a", to: "__end__" },
        ],
        input: { queryField: "q" },
        result: { answerField: "out" },
      },
    });
    expect(customBlueprint.resolveConversational(spec)).toBe(true);
  });

  it("含 approval 节点 → false（HITL 走 resume interrupt）", () => {
    const spec = parseSpec({
      name: "hitl-demo",
      description: "",
      topology: "custom",
      interaction: "approval",
      graphReason: "测试含 approval 节点的 custom HITL 场景。",
      params: {
        state: { out: { type: "any-last" } },
        nodes: { a: { type: "approval", params: { question: "()=>''", write: "(r)=>({})" } } },
        edges: [
          { kind: "static", from: "__start__", to: "a" },
          { kind: "static", from: "a", to: "__end__" },
        ],
        input: { queryField: "q" },
        result: { answerField: "out" },
      },
    });
    expect(customBlueprint.resolveConversational(spec)).toBe(false);
  });
});
