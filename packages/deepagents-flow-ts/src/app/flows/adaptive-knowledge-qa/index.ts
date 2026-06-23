/**
 * adaptive-knowledge-qa — adaptive-rag 拓扑（scaffold 生成，可手改）
 * 自适应知识库问答：路由（知识库/网页）→ 检索评分过滤 → 生成后幻觉/答案自纠正（对齐官方 Adaptive RAG）
 *
 * 图逻辑单一权威在 src/libs/topologies/adaptive-rag/；本文件只绑 spec。
 * 检索源 MCP_SERVERS 来自 spec.params.mcpServers（语义名 → stdio MCP 配置）。
 * 注意：检索驱动，spec.systemPrompt 不注入节点（领域 RAG prompt）。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import { createAdaptiveRagRecipe, getAdaptiveRagTopology } from "../../../libs/topologies/adaptive-rag/index.js";

/** 检索源 MCP 服务器（scaffold spec 注入；缺省空 → 无检索、走兜底回答）。 */
const MCP_SERVERS = {"context7":{"command":"npx","args":["-y","@upstash/context7-mcp"]}} as Record<
  string,
  { command?: string; args?: string[]; env?: Record<string, string>; url?: string }
>;

export const recipe = (runtime: FlowRuntime) => createAdaptiveRagRecipe(runtime, { mcpServers: MCP_SERVERS });

export const getTopology = () => getAdaptiveRagTopology();
