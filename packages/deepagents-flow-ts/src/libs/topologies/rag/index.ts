/**
 * rag 拓扑（libs 层，零 surface 依赖）。
 * 检索增强 one-shot：rewrite → retrieve(MCP) → grade(重试) → prepare → generate。
 * 图逻辑单一权威在此；examples（config-file-driven）与 scaffold（mcpServers-driven）复用。
 */
export {
  createRAGGraph,
  executeRAG,
  RAGStateAnnotation,
  type CreateRAGGraphConfig,
  type RAGStateType,
} from "./graph.js";
export { getRagTopology } from "./topology.js";
export { createRagExecutor, createRagRecipe, formatSourcesFooter, type RagExecutorOptions } from "./executor.js";
export {
  DEFAULT_RAG_CONFIG,
  type RAGConfig,
  type RAGResponse,
  type RAGState,
  type Source,
  type RetrievalResult,
} from "./nodes/types.js";
export {
  createRewriteNode,
  retrieveNode,
  gradeNode,
  routeAfterGrade,
  MAX_RETRIEVE_ATTEMPTS,
  prepareNode,
  generateNode,
} from "./nodes/index.js";
