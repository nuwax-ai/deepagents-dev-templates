/**
 * blueprint: rag —— 检索增强（conversational 多轮）。
 *
 *   rewrite → retrieve(MCP) → grade(重试) → prepare → generate
 * 适合：知识库问答、带来源引用的检索型助手。
 * 图逻辑单一权威在 src/libs/topologies/rag/；本 blueprint 只生成薄封装绑 spec。
 *
 * conversational：生成 recipe（createRagRecipe）→ 稳定 threadId + checkpointer 持久化 RAGState，
 * history 经 generate 节点写回 + append reducer 累积 → follow-up 问题用对话历史改写。
 *
 * spec.params.mcpServers 提供检索源（语义名 → stdio MCP 配置）。
 * spec.systemPrompt 不注入：rag 是检索驱动，rewrite/generate 是领域 RAG prompt。
 */

/** 拓扑 kind：conversational stateful-recipe（多轮记忆）。 */
export const kind = "stateful-recipe";
export const conversational = true;

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
 * conversational recipe：稳定 threadId + checkpointer → 多轮记忆（follow-up 问题用对话历史改写）。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import { createRagRecipe, getRagTopology } from "../../../libs/topologies/rag/index.js";

/** 检索源 MCP 服务器（scaffold spec 注入；缺省空 → 无检索、走兜底回答）。 */
const MCP_SERVERS = ${mcpServers} as Record<
  string,
  { command?: string; args?: string[]; env?: Record<string, string>; url?: string }
>;

export const recipe = (runtime: FlowRuntime) => createRagRecipe(runtime, { mcpServers: MCP_SERVERS });

export const getTopology = () => getRagTopology();
`;
  return [{ path: `src/app/flows/${spec.name}/index.ts`, content }];
}
