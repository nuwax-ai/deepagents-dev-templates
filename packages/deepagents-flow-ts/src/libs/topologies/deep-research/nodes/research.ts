/** 并行调研：research 子图（平台文档 MCP）+ Send 扇出。 */

export { createResearchSectionSubgraph } from "./research/subgraph.js";
export { isMcpErrorBodyText } from "./research/tools.js";
export {
  invokeDocRetrieval,
  extractBestLibraryId,
  DOC_RETRIEVAL_TIMEOUT_MS,
  type DocRetrievalMcp,
  type DocRetrievalResult,
} from "./research/doc-retrieval.js";
export {
  mergeResearchSources,
  scoreResearchSource,
  isSourceFailureText,
  type ResearchSourceKind,
  type ResearchSourceResult,
} from "./research/merge.js";
export { fanoutToResearch } from "./fanout.js";
