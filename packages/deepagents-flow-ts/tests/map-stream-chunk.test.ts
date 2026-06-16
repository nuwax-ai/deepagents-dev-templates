import { describe, it, expect } from "vitest";
import { INTERRUPT } from "@langchain/langgraph";
import { mapStreamChunk } from "../src/surfaces/map-stream-chunk.js";

describe("mapStreamChunk", () => {
  it("messages mode 抽文本增量", () => {
    const out = mapStreamChunk("messages", [{ content: "你好" }, { langgraph_node: "respond" }]);
    expect(out).toEqual([{ type: "text", text: "你好" }]);
  });

  it("messages content block 数组拼接文本", () => {
    const out = mapStreamChunk("messages", [
      { content: [{ type: "text", text: "foo" }, { type: "text", text: "bar" }] },
      {},
    ]);
    expect(out).toEqual([{ type: "text", text: "foobar" }]);
  });

  it("messages 空 content 不发事件", () => {
    expect(mapStreamChunk("messages", [{ content: "" }, {}])).toEqual([]);
  });

  it("custom mode stage", () => {
    const out = mapStreamChunk("custom", { type: "stage", stage: "调研", index: 1, total: 3, detail: "背景" });
    expect(out).toEqual([{ type: "stage", stage: "调研", index: 1, total: 3, detail: "背景" }]);
  });

  it("custom mode plan", () => {
    const entries = [
      { content: "背景（搜索：background）", priority: "medium", status: "pending" },
      { content: "架构（搜索：architecture）", priority: "high", status: "in_progress" },
    ] as const;
    const out = mapStreamChunk("custom", { type: "plan", entries });
    expect(out).toEqual([{ type: "plan", entries }]);
  });

  it("custom mode tool in_progress → tool_start", () => {
    const out = mapStreamChunk("custom", { type: "tool", id: "t1", name: "search", status: "in_progress", input: { q: "x" } });
    expect(out).toEqual([{ type: "tool_start", id: "t1", name: "search", input: { q: "x" } }]);
  });

  it("custom mode tool completed/failed → tool_update", () => {
    expect(mapStreamChunk("custom", { type: "tool", id: "t1", status: "completed", output: "ok" })).toEqual([
      { type: "tool_update", id: "t1", status: "completed", output: "ok" },
    ]);
    expect(mapStreamChunk("custom", { type: "tool", id: "t1", status: "failed", error: "boom" })).toEqual([
      { type: "tool_update", id: "t1", status: "failed", error: "boom" },
    ]);
  });

  it("updates mode 检测 __interrupt__（question 对象）", () => {
    const out = mapStreamChunk("updates", {
      reviewNode: { [INTERRUPT]: [{ value: { question: "确认？" } }] },
    });
    expect(out).toEqual([{ type: "interrupt", question: "确认？" }]);
  });

  it("updates mode 检测 __interrupt__（裸字符串 value）", () => {
    const out = mapStreamChunk("updates", {
      confirmNode: { [INTERRUPT]: [{ value: "继续吗" }] },
    });
    expect(out).toEqual([{ type: "interrupt", question: "继续吗" }]);
  });

  it("updates mode 无 interrupt 不发事件", () => {
    expect(mapStreamChunk("updates", { thinkNode: { output: "x" } })).toEqual([]);
  });

  it("tools mode on_tool_start → tool_start（input JSON 解析）", () => {
    const out = mapStreamChunk("tools", {
      event: "on_tool_start",
      toolCallId: "c1",
      name: "echo",
      input: '{"x":"hi"}',
    });
    expect(out).toEqual([{ type: "tool_start", id: "c1", name: "echo", input: { x: "hi" } }]);
  });

  it("tools mode on_tool_end success → tool_update completed", () => {
    const out = mapStreamChunk("tools", {
      event: "on_tool_end",
      toolCallId: "c1",
      name: "echo",
      output: { kwargs: { content: "echo:hi", status: "success" } },
    });
    expect(out).toEqual([{ type: "tool_update", id: "c1", status: "completed", output: "echo:hi" }]);
  });

  it("tools mode on_tool_end error → tool_update failed", () => {
    const out = mapStreamChunk("tools", {
      event: "on_tool_end",
      toolCallId: "c1",
      name: "echo",
      output: { kwargs: { content: "boom", status: "error" } },
    });
    expect(out).toEqual([{ type: "tool_update", id: "c1", status: "failed", output: "boom" }]);
  });

  it("tools mode 无 event 字段不发事件", () => {
    expect(mapStreamChunk("tools", { name: "echo" })).toEqual([]);
  });

  it("未知 mode 不发事件", () => {
    expect(mapStreamChunk("values", { x: 1 })).toEqual([]);
  });
});
