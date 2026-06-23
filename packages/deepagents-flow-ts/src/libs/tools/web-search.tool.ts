/**
 * Web Search Tool —— 网页搜索（Adaptive RAG 的 web_search 路径用）。
 *
 * 仿 http-request.tool.ts：@langchain/core/tools `tool()` + zod + fetch + AbortController 超时 + 截断。
 *
 * 后端策略（self-hosted 友好，默认免费无 key）：
 *  - 默认 DuckDuckGo Instant Answer API（免费、无 key，返回实体摘要 + 相关条目）。
 *  - 设了 WEB_SEARCH_API_KEY / TAVILY_API_KEY → 走 Tavily Search API（质量更高）。
 *
 * 返回 JSON 字符串 { source, query, count, text }：text 为拼好的检索正文，供 prepare 合并成 context。
 */
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const DDG_IA_URL = "https://api.duckduckgo.com/";
const TAVILY_URL = "https://api.tavily.com/search";

interface DDGTopic {
  Text?: string;
  FirstURL?: string;
}
interface DDGTopicGroup {
  Topics?: Array<DDGTopic | DDGTopicGroup>;
}
interface DDGResult {
  AbstractText?: string;
  AbstractSource?: string;
  AbstractURL?: string;
  Heading?: string;
  Answer?: string;
  Definition?: string;
  RelatedTopics?: Array<DDGTopic | DDGTopicGroup>;
}

/** 把 RelatedTopics 里的嵌套分组拍平成叶子 topic 列表。 */
function flattenTopics(items: Array<DDGTopic | DDGTopicGroup> = []): DDGTopic[] {
  const out: DDGTopic[] = [];
  for (const it of items) {
    if (it && typeof it === "object" && "Topics" in it && Array.isArray((it as DDGTopicGroup).Topics)) {
      out.push(...flattenTopics((it as DDGTopicGroup).Topics));
    } else {
      out.push(it as DDGTopic);
    }
  }
  return out;
}

/** 带 AbortController 超时的 fetch（与 http-request.tool.ts 一致风格）。 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 调 Tavily（有 key 时）。失败返回 null，由调用方回落 DuckDuckGo。 */
async function searchTavily(query: string, maxResults: number, apiKey: string, timeoutMs: number): Promise<string> {
  const resp = await fetchWithTimeout(
    TAVILY_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults }),
    },
    timeoutMs
  );
  // 鉴权失败/限流（401/429）时 resp.json() 不抛但 results 缺失 → 必须显式判 ok 抛错，
  // 否则上层拿到空 text 的"成功"字符串、不会回落 DuckDuckGo（web_search 路径静默拿空结果）。
  if (!resp.ok) {
    throw new Error(`Tavily ${resp.status} ${resp.statusText}`);
  }
  const json = (await resp.json()) as {
    results?: Array<{ content?: string; url?: string; title?: string }>;
  };
  const parts = (json.results ?? [])
    .slice(0, maxResults)
    .map((r, i) => `[${i + 1}] ${r.title ?? ""}${r.url ? ` (${r.url})` : ""}\n${r.content ?? ""}`);
  return JSON.stringify({ source: "tavily", query, count: parts.length, text: parts.join("\n\n") });
}

/** 调 DuckDuckGo Instant Answer（默认，免费无 key）。 */
async function searchDuckDuckGo(query: string, maxResults: number, timeoutMs: number): Promise<string> {
  const url = `${DDG_IA_URL}?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`;
  const resp = await fetchWithTimeout(url, { headers: { "User-Agent": "deepagents-flow-ts/rag" } }, timeoutMs);
  const data = (await resp.json()) as DDGResult;

  const parts: string[] = [];
  if (data.Answer) parts.push(`Answer: ${data.Answer}`);
  if (data.AbstractText) {
    parts.push(
      `${data.Heading ? `${data.Heading}\n` : ""}${data.AbstractText}${
        data.AbstractURL ? `\n来源: ${data.AbstractURL}` : ""
      }`
    );
  }
  const topics = flattenTopics(data.RelatedTopics).filter((t) => t.Text);
  for (const t of topics.slice(0, maxResults)) {
    parts.push(`${t.Text}${t.FirstURL ? `\n来源: ${t.FirstURL}` : ""}`);
  }

  const text = parts.join("\n\n");
  return JSON.stringify({ source: "duckduckgo", query, count: topics.length, text });
}

export const webSearchTool = tool(
  async ({ query, maxResults }) => {
    const tavilyKey = process.env.WEB_SEARCH_API_KEY || process.env.TAVILY_API_KEY;

    // 有 key → Tavily；失败回落 DuckDuckGo
    if (tavilyKey) {
      try {
        return await searchTavily(query, maxResults, tavilyKey, 15000);
      } catch (err) {
        // Tavily 鉴权/限流/网络失败 → 回落 DuckDuckGo。stderr 告警（ACP 协议走 stdout 不受影响），
        // 否则用户配了 key 却静默退到 DDG（质量骤降）无感知。
        console.warn(
          `[web_search] Tavily failed, fallback to DuckDuckGo: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    try {
      return await searchDuckDuckGo(query, maxResults, 10000);
    } catch (err) {
      return JSON.stringify({
        source: "duckduckgo",
        query,
        count: 0,
        text: "",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
  {
    name: "web_search",
    description: `Search the web for fresh / external information (recent events, news, real-time data, facts not in the local knowledge base).
Default backend is DuckDuckGo Instant Answer (free, no key); set WEB_SEARCH_API_KEY to use Tavily.
Returns JSON { source, query, count, text }.`,
    schema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(3)
        .describe("Max result entries to return"),
    }),
  }
);
