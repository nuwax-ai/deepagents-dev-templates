/**
 * knowledge-qa — rag 拓扑（scaffold 生成，可手改）
 * 知识库问答：重写查询 → MCP 检索 → 评级重试 → 生成带来源的回答（one-shot）
 *
 * 图逻辑单一权威在 src/libs/topologies/rag/；本文件只绑 spec。
 * 检索源 MCP_SERVERS 来自 spec.params.mcpServers（语义名 → stdio MCP 配置）。
 * 注意：rag 检索驱动，spec.systemPrompt 不注入节点（领域 RAG prompt）。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { FlowExecutor } from "../../../core/flow-types.js";
import { createRagExecutor, getRagTopology } from "../../../libs/topologies/rag/index.js";

/** 检索源 MCP 服务器（scaffold spec 注入；缺省空 → 无检索、走兜底回答）。 */
const MCP_SERVERS = {"duckduckgo":{"command":"npx","args":["-y","duckduckgo-mcp-server"]}} as Record<
  string,
  { command?: string; args?: string[]; env?: Record<string, string>; url?: string }
>;

export const createExecutor = (runtime: FlowRuntime): FlowExecutor =>
  createRagExecutor(runtime, { mcpServers: MCP_SERVERS });

export const getTopology = () => getRagTopology();
