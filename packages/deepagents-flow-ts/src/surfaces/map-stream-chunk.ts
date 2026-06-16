/**
 * mapStreamChunk —— 把 LangGraph 多模式 stream 的一个 `[mode, chunk]` 归一成
 * `SurfaceStreamEvent[]`。纯函数，供 surface（ACP/CLI）消费；surface 不再各自
 * 解析原生事件。
 *
 * 执行仍是 `graph.stream(input, { streamMode: ["messages","tools","custom","updates"] })`，
 * `for await (const [mode, chunk] of stream) yield* mapStreamChunk(mode, chunk)`。
 *
 * chunk 形状依 LangGraph 版本；本实现基于 @langchain/langgraph 多模式约定：
 *  - `messages`: `[AIMessageChunk, metadata]` —— 文本增量（按 metadata.langgraph_node
 *    过滤回答节点，避免把规划/工具前置 LLM 的 token 吐给用户；过滤由调用方做，
 *    这里只抽文本）。
 *  - `custom`: 节点 `config.writer(payload)` —— payload.type 区分 stage / tool。
 *  - `updates`: `{ nodeName: delta }` —— 检测 `__interrupt__`（INTERRUPT）。
 *  - `tools`: ToolNode 生命周期 —— 形状待 spike（surface 接入时按当前版本补全）。
 */

import { INTERRUPT } from "@langchain/langgraph";
import type { SurfaceStreamEvent } from "./stream-events.js";

/** 从 LLM content（string 或 content block 数组）抽纯文本。 */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && "text" in b
          ? String((b as { text: unknown }).text)
          : ""
      )
      .join("");
  }
  return "";
}

export function mapStreamChunk(mode: string, chunk: unknown): SurfaceStreamEvent[] {
  const events: SurfaceStreamEvent[] = [];

  if (mode === "messages") {
    const pair = chunk as [{ content?: unknown }, unknown] | undefined;
    if (Array.isArray(pair) && pair[0]?.content) {
      const text = extractText(pair[0].content);
      if (text) events.push({ type: "text", text });
    }
    return events;
  }

  if (mode === "custom") {
    const payload = chunk as { type?: string } | undefined;
    if (!payload || typeof payload !== "object") return events;
    if (payload.type === "stage") {
      const s = payload as {
        stage: string;
        index?: number;
        total?: number;
        detail?: string;
      };
      events.push({
        type: "stage",
        stage: s.stage,
        ...(s.index !== undefined ? { index: s.index } : {}),
        ...(s.total !== undefined ? { total: s.total } : {}),
        ...(s.detail !== undefined ? { detail: s.detail } : {}),
      });
    } else if (payload.type === "tool") {
      const t = payload as {
        id?: string;
        name?: string;
        status?: string;
        input?: unknown;
        output?: unknown;
        error?: string;
      };
      const id = t.id ?? t.name ?? "";
      if (t.status === "in_progress" && t.name) {
        events.push({ type: "tool_start", id, name: t.name, ...(t.input !== undefined ? { input: t.input } : {}) });
      } else if (t.status === "completed" || t.status === "failed") {
        events.push({
          type: "tool_update",
          id,
          status: t.status,
          ...(t.output !== undefined ? { output: t.output } : {}),
          ...(t.error !== undefined ? { error: t.error } : {}),
        });
      }
    }
    return events;
  }

  if (mode === "updates") {
    const updates = chunk as Record<string, Record<string, unknown>> | undefined;
    if (updates && typeof updates === "object") {
      for (const delta of Object.values(updates)) {
        if (!delta || typeof delta !== "object") continue;
        const intr = delta[INTERRUPT] as
          | Array<{ value?: { question?: string } | string }>
          | undefined;
        if (intr && intr.length) {
          const v = intr[intr.length - 1]?.value;
          const question =
            typeof v === "string" ? v : v?.question ?? String(v ?? "");
          events.push({ type: "interrupt", question });
        }
      }
    }
    return events;
  }

  // tools mode（ToolNode 生命周期）：形状待 spike（@langchain/langgraph 版本），
  // surface 接入时按实际事件补全 tool_start/tool_update。当前不映射，避免基于错误形状。
  return events;
}
