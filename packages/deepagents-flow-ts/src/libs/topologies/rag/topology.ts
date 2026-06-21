/**
 * rag 拓扑静态反射 —— 不运行图、不需凭证。
 * 节点名：__start__ → rewrite → retrieve → grade_docs →(cond) rewrite|prepare → generate → __end__。
 */
import { createRAGGraph } from "./graph.js";
import { DEFAULT_RAG_CONFIG } from "./nodes/types.js";
import { reflectTopology } from "../reflect.js";
import type { FlowTopology } from "../../../core/flow-types.js";

export async function getRagTopology(): Promise<FlowTopology> {
  // 最小配置建图（空 mcpServers；不 invoke、不需凭证），仅反射结构。
  return reflectTopology(createRAGGraph({ ...DEFAULT_RAG_CONFIG, mcpServers: {} }));
}
