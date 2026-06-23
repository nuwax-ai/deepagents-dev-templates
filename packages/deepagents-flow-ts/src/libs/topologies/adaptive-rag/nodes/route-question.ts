/**
 * route_question 节点 —— 问题路由器（对齐官方 Adaptive RAG 的 RouteQuery）。
 *
 * 用 createLlmNode({parse}) 做结构化裁决：问题走「知识库检索 vectorstore」还是「网页搜索 web_search」。
 * 路由结果写到 state.route，由纯函数条件边 routeAfterRouteQuestion 消费（不用 Command goto，
 * 与 rag/graph.ts 的 routeAfterGrade 风格一致，oneshot 图无需 checkpointer 即可路由）。
 *
 * - 近期事件 / 新闻 / 实时数据 / 知识库外的事实 → web_search
 * - 技术文档 / 编程库 / API / 已索引领域知识 → vectorstore（即 retrieve）
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { type AppConfig } from "../../../../runtime/index.js";
import { resolveLlmResilience } from "../../../../runtime/services/llm-resilience.js";
import { createLlmNode, parseJson, requireModel } from "../../../nodes/index.js";
import type { AdaptiveRAGState } from "./types.js";

const ROUTE_PROMPT = `你是问题路由专家。判断用户问题应该走「知识库检索」还是「网页搜索」。

- vectorstore（知识库检索）：技术文档、编程语言/开源框架（React/LangGraph/Python 等）、API、SDK 的用法、已索引的领域知识。
- web_search（网页搜索）：近期事件、新闻、实时数据、知识库之外的事实。

只输出 JSON：{"datasource": "vectorstore" | "web_search"}`;

/** route_question 节点：LLM 结构化裁决 → 写 state.route。 */
export function createRouteQuestionNode(appConfig?: AppConfig) {
  return createLlmNode<AdaptiveRAGState>({
    // 无凭证 → requireModel 抛错（model 解析在 createLlmNode 的 try 外），由 executeAdaptiveRAG 顶层 catch 兜底；
    // 瞬态调用失败（429/超时）→ 下方 fallback 降级为 vectorstore（不卡死，默认走知识库检索）。
    model: () => requireModel(appConfig, "adaptive-rag route_question"),
    prompt: (s) => {
      const q = s.rewritten_query || s.query;
      return [new SystemMessage(ROUTE_PROMPT), new HumanMessage(q)];
    },
    parse: (t) => parseJson<{ datasource?: string }>(t),
    write: (r) => {
      const d = (r.parsed ?? {}) as { datasource?: string };
      const route = d.datasource === "web_search" ? "web_search" : "vectorstore";
      return { route };
    },
    fallback: () => ({ route: "vectorstore" }),
    config: appConfig,
    label: "adaptive-rag route_question",
    attempts: 1,
    timeoutMs: resolveLlmResilience(appConfig).shortTimeoutMs,
  });
}

/**
 * 纯函数条件边：返回 datasource 裁决（"web_search" | "vectorstore"），由映射对象转节点名。
 * - route==="web_search" → web_search 节点
 * - 否则（vectorstore）→ retrieve 节点
 *
 * 映射对象：{ web_search: "web_search", vectorstore: "retrieve" }（见 graph.ts）。
 * 返回值须与映射 key 对齐——否则 LangGraph 把返回值当节点名兜底（易混淆、未来版本可能严格校验报错）。
 */
export function routeAfterRouteQuestion(state: AdaptiveRAGState): "web_search" | "vectorstore" {
  return state.route === "web_search" ? "web_search" : "vectorstore";
}
