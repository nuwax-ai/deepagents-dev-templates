/**
 * deep-research 拓扑（libs 层，零 surface 依赖）。
 * durable stateful flow 多阶段：clarify → plan → outline_gate →(Send) research → review → draft → converse ↔ respond → delivery。
 * 图逻辑单一权威在此；scaffold 经 researchRecipe 复用。
 */
export * from "./graph.js";
export { getResearchTopology } from "./topology.js";
export { researchRecipe } from "./recipe.js";
