/**
 * 节点类型目录一致性守卫 —— 防 schema.mjs 的 custom node.type enum 与 docs/node-catalog.md 漂移。
 * custom DSL 支持的节点 type 必须在 catalog 文档里有记录（catalog 是 type 词表的单一权威）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_TOPOLOGIES } from "../scripts/scaffold/schema.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const catalog = readFileSync(resolve(here, "../docs/node-catalog.md"), "utf-8");

/**
 * custom DSL 支持的节点 type（canonical）—— 须与 schema.mjs 的 customNodeSchema.type enum、
 * src/libs/topologies/custom/graph.ts 的 buildNode switch 三处保持一致。
 * 新增 type 时三处同步 + 本列表同步。
 */
const CUSTOM_NODE_TYPES = [
  "llm",
  "llm-router",
  "approval",
  "approval-finalize",
  "mcp-retrieval",
  "prepare",
  "passthrough",
];

describe("节点类型目录一致性", () => {
  it("SUPPORTED_TOPOLOGIES 含 custom（节点级编排入口）+ 7 预设", () => {
    expect(SUPPORTED_TOPOLOGIES).toContain("custom");
    for (const t of [
      "react-tools",
      "human-in-loop",
      "project-manager",
      "travel-planner",
      "rag",
      "deep-research",
      "dev-agent",
    ]) {
      expect(SUPPORTED_TOPOLOGIES).toContain(t);
    }
  });

  it("catalog 文档记录了所有 custom DSL 节点 type（防 catalog 漂移）", () => {
    for (const t of CUSTOM_NODE_TYPES) {
      expect(catalog, `catalog 缺少 custom DSL type "${t}"`).toContain(`\`${t}\``);
    }
  });
});
