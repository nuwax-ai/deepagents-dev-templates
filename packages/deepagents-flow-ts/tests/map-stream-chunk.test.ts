import { describe, it, expect } from "vitest";
import { INTERRUPT } from "@langchain/langgraph";
import { mapStreamChunk } from "../src/surfaces/map-stream-chunk.js";

describe("mapStreamChunk", () => {
  it("messages → text（string 与 content block）", () => {
    expect(mapStreamChunk("messages", [{ content: "你好" }, {}])).toEqual([
      { type: "text", text: "你好" },
    ]);
    expect(
      mapStreamChunk("messages", [
        { content: [{ type: "text", text: "foo" }, { type: "text", text: "bar" }] },
        {},
      ])
    ).toEqual([{ type: "text", text: "foobar" }]);
    expect(mapStreamChunk("messages", [{ content: "" }, {}])).toEqual([]);
  });

  it("custom → stage / plan / tool 三态", () => {
    expect(
      mapStreamChunk("custom", { type: "stage", stage: "调研", index: 1, total: 3 })
    ).toEqual([{ type: "stage", stage: "调研", index: 1, total: 3, detail: undefined }]);

    const entries = [{ content: "step1", priority: "high", status: "pending" }] as const;
    expect(mapStreamChunk("custom", { type: "plan", entries })).toEqual([
      { type: "plan", entries },
    ]);

    expect(
      mapStreamChunk("custom", {
        type: "tool",
        id: "t1",
        name: "search",
        status: "in_progress",
        input: { q: "x" },
      })
    ).toEqual([{ type: "tool_start", id: "t1", name: "search", input: { q: "x" } }]);

    expect(
      mapStreamChunk("custom", { type: "tool", id: "t1", status: "completed", output: "ok" })
    ).toEqual([{ type: "tool_update", id: "t1", status: "completed", output: "ok" }]);
  });

  it("updates → __interrupt__", () => {
    expect(
      mapStreamChunk("updates", {
        reviewNode: { [INTERRUPT]: [{ value: { question: "确认？" } }] },
      })
    ).toEqual([{ type: "interrupt", question: "确认？" }]);
    expect(mapStreamChunk("updates", { thinkNode: { output: "x" } })).toEqual([]);
  });

  it("tools → on_tool_start / on_tool_end", () => {
    expect(
      mapStreamChunk("tools", {
        event: "on_tool_start",
        toolCallId: "c1",
        name: "echo",
        input: '{"x":"hi"}',
      })
    ).toEqual([{ type: "tool_start", id: "c1", name: "echo", input: { x: "hi" } }]);

    expect(
      mapStreamChunk("tools", {
        event: "on_tool_end",
        toolCallId: "c1",
        name: "echo",
        output: { kwargs: { content: "echo:hi", status: "success" } },
      })
    ).toEqual([
      { type: "tool_update", id: "c1", name: "echo", status: "completed", output: "echo:hi" },
    ]);
  });

  it("未知 mode / 缺字段 → 空", () => {
    expect(mapStreamChunk("values", { x: 1 })).toEqual([]);
    expect(mapStreamChunk("tools", { name: "echo" })).toEqual([]);
  });
});
