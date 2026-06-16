/** 并行调研：Send 扇出 + research 子图（mini ReAct + ToolNode）。 */

import { Send } from "@langchain/langgraph";
import type { ResearchStateShape } from "./types.js";

export { createResearchSectionSubgraph } from "./research/subgraph.js";
export { createDuckDuckGoSearchTool, SEARCH_MCP, SEARCH_TIMEOUT_MS } from "./research/tools.js";

/**
 * fanoutToResearch：条件边 / Command.goto — 为每个 outline section 派一个 research 子图实例。
 * 导出供单测与 outlineGate Command 路由复用。
 */
export function fanoutToResearch(state: ResearchStateShape): Send[] {
  return state.outline.map(
    (section) =>
      new Send("research", {
        currentSection: section,
        outline: state.outline,
        refinedTopic: state.refinedTopic,
        languageHint: state.languageHint,
      })
  );
}
