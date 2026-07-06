/**
 * sanitizeToolCalls —— 清除 checkpoint 中孤立的 AIMessage.tool_calls。
 */

import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { sanitizeToolCalls } from "../src/libs/messages/sanitize-tool-calls.js";

describe("sanitizeToolCalls", () => {
  it("完整 tool_calls + ToolMessage → 不变", () => {
    const messages = [
      new HumanMessage("hi"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call_1", name: "bash", args: { command: "ls" } }],
      }),
      new ToolMessage({ content: "ok", tool_call_id: "call_1" }),
    ];
    expect(sanitizeToolCalls(messages)).toBe(messages);
  });

  it("孤立 tool_calls（无 ToolMessage）→ 从 AIMessage 移除", () => {
    const messages = [
      new HumanMessage("搜一下"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call_orphan", name: "web_search", args: { q: "x" } }],
      }),
    ];
    const out = sanitizeToolCalls(messages);
    const ai = out[1] as AIMessage;
    expect(ai.tool_calls ?? []).toHaveLength(0);
  });

  it("部分孤立：保留有 ToolMessage 的 call，移除孤立的", () => {
    const messages = [
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "call_ok", name: "bash", args: {} },
          { id: "call_bad", name: "web_search", args: {} },
        ],
      }),
      new ToolMessage({ content: "done", tool_call_id: "call_ok" }),
    ];
    const out = sanitizeToolCalls(messages);
    const ai = out[0] as AIMessage;
    expect(ai.tool_calls?.map((c) => c.id)).toEqual(["call_ok"]);
  });

  it("无 tool_calls → 原样返回", () => {
    const messages = [new HumanMessage("hello"), new AIMessage("reply")];
    expect(sanitizeToolCalls(messages)).toBe(messages);
  });

  it("checkpoint 反序列化 plain object（非类实例）→ 仍能清除孤立 tool_calls", () => {
    const messages = [
      { type: "human", content: "搜一下" },
      {
        type: "ai",
        content: "",
        tool_calls: [{ id: "call_orphan", name: "web_search", args: { q: "x" } }],
      },
    ] as unknown as BaseMessage[];
    const out = sanitizeToolCalls(messages);
    const ai = out[1] as AIMessage;
    expect(ai.tool_calls ?? []).toHaveLength(0);
  });
});
