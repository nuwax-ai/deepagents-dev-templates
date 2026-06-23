/**
 * adaptive-rag 拓扑（libs 层，零 surface 依赖）。
 *
 * 检索增强 + 自适应路由 + 生成后自纠正（对齐官方 LangGraph Adaptive RAG）：
 *   rewrite → route_question →{web_search|retrieve} → grade_documents →{transform_query|prepare}
 *   → generate → grade_generation →{useful:END|not_supported:generate|not_useful:transform_query}
 *
 * 图逻辑单一权威在此；复用 rag 的 rewrite/retrieve/prepare/generate 节点（libs/topologies/rag/）。
 */
export {
  createAdaptiveRAGGraph,
  executeAdaptiveRAG,
  AdaptiveRAGStateAnnotation,
  type CreateAdaptiveRAGGraphConfig,
  type AdaptiveRAGStateType,
} from "./graph.js";
export { getAdaptiveRagTopology } from "./topology.js";
export {
  createAdaptiveRagExecutor,
  createAdaptiveRagRecipe,
  type AdaptiveRagExecutorOptions,
} from "./executor.js";
export {
  DEFAULT_ADAPTIVE_RAG_CONFIG,
  type AdaptiveRAGConfig,
  type AdaptiveRAGState,
} from "./nodes/types.js";
export {
  createRouteQuestionNode,
  routeAfterRouteQuestion,
  webSearchNode,
  gradeDocumentsNode,
  routeAfterGradeDocuments,
  MAX_RETRIEVE_ATTEMPTS,
  createTransformQueryNode,
  gradeGenerationNode,
  routeAfterGradeGeneration,
  MAX_GENERATION_ATTEMPTS,
} from "./nodes/index.js";
