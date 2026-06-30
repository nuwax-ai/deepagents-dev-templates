/**
 * adaptive-knowledge-qa — adaptive-rag 拓扑（scaffold 生成，可手改）
 * 自适应知识库问答：路由（知识库/网页）→ 检索评分过滤 → 生成后幻觉/答案自纠正（对齐官方 Adaptive RAG）
 *
 * 图逻辑单一权威在 src/libs/topologies/adaptive-rag/；本文件只绑 spec。
 *
 * **联网 / 网页搜索（强制）**：模板不提供内置联网搜索。需要时须到**平台**查找并添加：
 *   1. 加载 dev-engineer-toolkit → search-apis.sh（关键词：搜索 / 联网 / web）
 *   2. get-config.sh --key mcpConfigs → 将平台搜索 MCP 填入下方 SEARCH_MCP
 *   3. 知识库检索同理：平台登记后填入 MCP_SERVERS
 * 禁止用 bash+curl / http_request 替代平台已登记的搜索能力。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { TravelSearchMcp } from "../../../libs/topologies/travel-planner/graph.js";
import { createAdaptiveRagRecipe, getAdaptiveRagTopology } from "../../../libs/topologies/adaptive-rag/index.js";

/** 知识库检索 MCP（平台登记后填入；缺省空）。 */
const MCP_SERVERS = {} as Record<
  string,
  { command?: string; args?: string[]; env?: Record<string, string>; url?: string }
>;

/**
 * 网页搜索 MCP（平台查找并添加后填入；route → web_search 路径用）。
 * 示例：const SEARCH_MCP: TravelSearchMcp = { config: { ... }, tool: "search" };
 */
const SEARCH_MCP: TravelSearchMcp | undefined = undefined;

export const recipe = (runtime: FlowRuntime) =>
  createAdaptiveRagRecipe(runtime, { mcpServers: MCP_SERVERS, searchMcp: SEARCH_MCP });

export const getTopology = () => getAdaptiveRagTopology();
