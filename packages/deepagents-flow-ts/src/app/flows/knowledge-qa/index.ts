/**
 * knowledge-qa — rag 拓扑（scaffold 生成，可手改）
 * 知识库问答：重写查询 → MCP 检索 → 评级重试 → 生成带来源的回答（conversational 多轮）
 *
 * 图逻辑单一权威在 src/libs/topologies/rag/；本文件只绑 spec。
 * 知识库 MCP_SERVERS：须到**平台**查找并添加（dev-engineer-toolkit → mcpConfigs）后填入。
 * 若需联网搜索而非知识库，请用 adaptive-knowledge-qa / search-aggregator，并在平台登记搜索 MCP。
 * 注意：rag 检索驱动，spec.systemPrompt 不注入节点（领域 RAG prompt）。
 * conversational recipe：稳定 threadId + checkpointer → 多轮记忆（follow-up 问题用对话历史改写）。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import { createRagRecipe, getRagTopology } from "../../../libs/topologies/rag/index.js";

/** 检索源 MCP 服务器（平台登记后填入；缺省空 → 无检索、走兜底回答）。 */
const MCP_SERVERS = {} as Record<
  string,
  { command?: string; args?: string[]; env?: Record<string, string>; url?: string }
>;

export const recipe = (runtime: FlowRuntime) => createRagRecipe(runtime, { mcpServers: MCP_SERVERS });

export const getTopology = () => getRagTopology();
