/**
 * adaptive-rag 拓扑静态反射 —— 不运行图、不需凭证。
 *
 * 节点名：__start__ → rewrite → route_question →(cond) web_search|retrieve →
 *   retrieve → grade_documents →(cond) transform_query|prepare →
 *   web_search → prepare → generate → grade_gen →(cond) generate|transform_query|__end__。
 *
 * 纯函数 addConditionalEdges 可被 reflectTopology 正确反射（仅 Command goto 路由才需声明 ends）。
 */
import { createAdaptiveRAGGraph } from "./graph.js";
import { DEFAULT_ADAPTIVE_RAG_CONFIG } from "./nodes/types.js";
import { reflectTopology } from "../reflect.js";
import type { FlowTopology } from "../../../core/flow-types.js";

export async function getAdaptiveRagTopology(): Promise<FlowTopology> {
  // 最小配置建图（空 mcpServers；不 invoke、不需凭证），仅反射结构。
  return reflectTopology(createAdaptiveRAGGraph({ ...DEFAULT_ADAPTIVE_RAG_CONFIG, mcpServers: {} }));
}
