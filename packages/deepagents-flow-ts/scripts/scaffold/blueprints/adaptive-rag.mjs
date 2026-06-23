/**
 * blueprint: adaptive-rag —— 自适应检索增强 one-shot（对齐官方 LangGraph Adaptive RAG）。
 *
 *   rewrite → route_question →{web_search|retrieve} → grade_documents →{transform_query|prepare}
 *   → generate → grade_generation →{useful:END|not_supported:generate|not_useful:transform_query}
 * 适合：需要路由（知识库 vs 网页）、检索评分过滤、生成后幻觉/答案自纠正的进阶问答。
 * 图逻辑单一权威在 src/libs/topologies/adaptive-rag/；本 blueprint 只生成薄封装绑 spec。
 *
 * spec.params.mcpServers 提供检索源（语义名 → stdio MCP 配置）。
 * spec.systemPrompt 不注入：检索驱动，各节点是领域 RAG prompt。
 */

/** 拓扑 kind。 */
export const kind = "oneshot";

/**
 * @param {{name:string,description:string,systemPrompt:string,params?:{mcpServers?:Record<string,unknown>}}} spec
 */
export function render(spec) {
  const mcpServers = JSON.stringify(spec.params?.mcpServers ?? {});
  const content = `/**
 * ${spec.name} — adaptive-rag 拓扑（scaffold 生成，可手改）
 * ${spec.description || "自适应检索增强：route_question + web_search + grade + 幻觉/答案评分自纠正"}
 *
 * 图逻辑单一权威在 src/libs/topologies/adaptive-rag/；本文件只绑 spec。
 * 检索源 MCP_SERVERS 来自 spec.params.mcpServers（语义名 → stdio MCP 配置）。
 * 注意：检索驱动，spec.systemPrompt 不注入节点（领域 RAG prompt）。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { FlowExecutor } from "../../../core/flow-types.js";
import { createAdaptiveRagExecutor, getAdaptiveRagTopology } from "../../../libs/topologies/adaptive-rag/index.js";

/** 检索源 MCP 服务器（scaffold spec 注入；缺省空 → 无检索、走兜底回答）。 */
const MCP_SERVERS = ${mcpServers} as Record<
  string,
  { command?: string; args?: string[]; env?: Record<string, string>; url?: string }
>;

export const createExecutor = (runtime: FlowRuntime): FlowExecutor =>
  createAdaptiveRagExecutor(runtime, { mcpServers: MCP_SERVERS });

export const getTopology = () => getAdaptiveRagTopology();
`;
  return [{ path: `src/app/flows/${spec.name}/index.ts`, content }];
}
