/**
 * 图拓扑导出测试 —— 守住「可视化对接」的公开 API getFlowTopology()。
 * 拓扑从编译图反射,所以这同时是 graph.ts 连线的回归守卫:
 * 改了 addNode/addEdge/addConditionalEdges,这里会跟着变(或报警)。
 */

import { describe, it, expect } from "vitest";
import { getFlowTopology } from "../src/app/topology.js";

describe("getFlowTopology", () => {
  it("导出全部业务节点(+ start/end)", async () => {
    const { nodes } = await getFlowTopology();
    const ids = nodes.map((n) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "__start__",
        "prepare",
        "think",
        "act",
        "observe",
        "reflect",
        "respond",
        "__end__",
      ])
    );
    expect(nodes.every((n) => n.label.length > 0)).toBe(true);
  });

  it("条件边只在 reflect 出口(think / respond),且被标记 conditional", async () => {
    const { edges } = await getFlowTopology();
    const conditional = edges.filter((e) => e.conditional);
    expect(conditional).toHaveLength(2);
    expect(conditional.every((e) => e.source === "reflect")).toBe(true);
    expect(conditional.map((e) => e.target).sort()).toEqual(["respond", "think"]);
  });

  it("主干顺序边存在且非条件", async () => {
    const { edges } = await getFlowTopology();
    const has = (source: string, target: string) =>
      edges.some((e) => e.source === source && e.target === target && !e.conditional);
    expect(has("__start__", "prepare")).toBe(true);
    expect(has("prepare", "think")).toBe(true);
    expect(has("think", "act")).toBe(true);
    expect(has("act", "observe")).toBe(true);
    expect(has("observe", "reflect")).toBe(true);
    expect(has("respond", "__end__")).toBe(true);
  });

  it("产出可渲染的 Mermaid 源", async () => {
    const { mermaid } = await getFlowTopology();
    expect(mermaid).toContain("graph TD");
    expect(mermaid).toContain("reflect");
  });
});
