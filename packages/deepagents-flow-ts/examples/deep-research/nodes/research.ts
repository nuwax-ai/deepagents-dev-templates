/** 并行调研：research 子图（mini ReAct + ToolNode）+ Send 扇出。 */

export { createResearchSectionSubgraph } from "./research/subgraph.js";
export { createDuckDuckGoSearchTool, SEARCH_MCP, SEARCH_TIMEOUT_MS } from "./research/tools.js";
export { fanoutToResearch } from "./fanout.js";
