/**
 * deep-research 拓扑（libs 层，零 surface 依赖）。
 * durable stateful flow 多阶段：clarify → plan → outline_gate →(Send) research → review → draft → converse ↔ respond → delivery。
 * 图逻辑单一权威在此；examples（createStatefulFlow 包装）与 scaffold（recipe）复用。
 */
export * from "./graph.js";
export { getResearchTopology } from "./topology.js";
export { researchRecipe } from "./recipe.js";
