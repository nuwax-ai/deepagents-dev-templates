/**
 * human-in-loop 拓扑（libs 层，零 surface 依赖）。
 *
 * 线性 + 结构化提问 + 中途 interrupt：compose → present_review(MCP，可选) → review(interrupt) → finalize。
 * 图逻辑单一权威在此；scaffold 生成的 flow 经 createReviewGraph / reviewRecipe 复用。
 */
export {
  createReviewGraph,
  createAskQuestionPresentationNode,
  findAskQuestionTool,
  normalizeReviewFeedback,
  ReviewState,
  type ReviewStateType,
} from "./graph.js";
export { getReviewTopology } from "./topology.js";
export { reviewRecipe } from "./recipe.js";
