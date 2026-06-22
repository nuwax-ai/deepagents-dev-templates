/** 并行调研：research 子图（Context7 检索）+ Send 扇出。 */

export { createResearchSectionSubgraph } from "./research/subgraph.js";
export { isDdgErrorText } from "./research/tools.js";
export {
  invokeContext7Search,
  extractBestLibraryId,
  CONTEXT7_MCP,
  CONTEXT7_TIMEOUT_MS,
} from "./research/context7.js";
export {
  mergeResearchSources,
  scoreResearchSource,
  isSourceFailureText,
  type ResearchSourceKind,
  type ResearchSourceResult,
} from "./research/merge.js";
export { fanoutToResearch } from "./fanout.js";
