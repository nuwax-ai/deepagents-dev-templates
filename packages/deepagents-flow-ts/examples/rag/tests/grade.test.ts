/**
 * Grade 节点 + 条件路由 单测（纯函数，无 mock）
 *
 * 这是工作流编排的"连线规则"本体：grade 判定 + routeAfterGrade 决定走哪条边。
 */

import { describe, it, expect } from "vitest";
import {
  gradeNode,
  routeAfterGrade,
  MAX_RETRIEVE_ATTEMPTS,
} from "../nodes/grade.js";
import type { RAGState } from "../nodes/types.js";

describe("gradeNode", () => {
  it("空检索 → insufficient", () => {
    expect(gradeNode({ query: "q", raw_results: [] }).grade).toBe("insufficient");
  });

  it("仅空白内容 → insufficient", () => {
    expect(
      gradeNode({ query: "q", raw_results: [{ tool: "t", content: "   " }] }).grade
    ).toBe("insufficient");
  });

  it("有实质内容 → sufficient", () => {
    expect(
      gradeNode({ query: "q", raw_results: [{ tool: "t", content: "real" }] }).grade
    ).toBe("sufficient");
  });
});

describe("routeAfterGrade (条件边)", () => {
  const state = (over: Partial<RAGState>): RAGState => ({ query: "q", ...over });

  it("sufficient → prepare（无论尝试次数）", () => {
    expect(routeAfterGrade(state({ grade: "sufficient", attempts: 0 }))).toBe("prepare");
  });

  it("insufficient 且未达上限 → rewrite（重试）", () => {
    expect(routeAfterGrade(state({ grade: "insufficient", attempts: 1 }))).toBe("rewrite");
  });

  it("insufficient 且达到上限 → prepare（防死循环）", () => {
    expect(
      routeAfterGrade(state({ grade: "insufficient", attempts: MAX_RETRIEVE_ATTEMPTS }))
    ).toBe("prepare");
  });

  it("缺省 attempts 视为 0 → rewrite", () => {
    expect(routeAfterGrade(state({ grade: "insufficient" }))).toBe("rewrite");
  });
});
