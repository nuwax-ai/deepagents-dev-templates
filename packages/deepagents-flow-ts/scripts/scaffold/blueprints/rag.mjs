/**
 * blueprint: rag —— 检索增强 one-shot。
 *
 *   rewrite → retrieve(MCP) → grade(重试) → prepare → generate
 * 适合：知识库问答、带来源引用的检索型助手。
 * 图逻辑单一权威在 src/libs/topologies/rag/；本 blueprint 只生成薄封装绑 spec。
 *
 * spec.params.mcpServers 提供检索源（语义名 → stdio MCP 配置）。
 * spec.systemPrompt 不注入：rag 是检索驱动，rewrite/generate 是领域 RAG prompt。
 */

/** 拓扑 kind。 */
export const kind = "oneshot";

/**
 * @param {{name:string,description:string,systemPrompt:string,params?:{mcpServers?:Record<string,unknown>}}} spec
 */
export function render(spec) {
  const mcpServers = JSON.stringify(spec.params?.mcpServers ?? {});
  const content = `/**
 * ${spec.name} — rag 拓扑（scaffold 生成，可手改）
 * ${spec.description || "检索增强：rewrite → retrieve(MCP) → grade(重试) → prepare → generate"}
 *
 * 图逻辑单一权威在 src/libs/topologies/rag/；本文件只绑 spec。
 * 检索源 MCP_SERVERS 来自 spec.params.mcpServers（语义名 → stdio MCP 配置）。
 * 注意：rag 检索驱动，spec.systemPrompt 不注入节点（领域 RAG prompt）。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { FlowExecutor } from "../../../core/flow-types.js";
import { createRagExecutor, getRagTopology } from "../../../libs/topologies/rag/index.js";

/** 检索源 MCP 服务器（scaffold spec 注入；缺省空 → 无检索、走兜底回答）。 */
const MCP_SERVERS = ${mcpServers} as Record<
  string,
  { command?: string; args?: string[]; env?: Record<string, string>; url?: string }
>;

export const createExecutor = (runtime: FlowRuntime): FlowExecutor =>
  createRagExecutor(runtime, { mcpServers: MCP_SERVERS });

export const getTopology = () => getRagTopology();
`;
  return [{ path: `src/app/flows/${spec.name}/index.ts`, content }];
}
