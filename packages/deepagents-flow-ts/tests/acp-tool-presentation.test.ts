import { describe, it, expect } from "vitest";
import {
  markdownEscape,
  preserveRawOutput,
  toolInfoFromToolEvent,
  toolUpdateFromToolResult,
  buildPermissionToolCall,
} from "../src/libs/deepagents-acp/acp-tool-presentation.js";

describe("acp-tool-presentation", () => {
  const cwd = "/workspace/proj";

  describe("toolInfoFromToolEvent", () => {
    it("read_file 含 locations", () => {
      const info = toolInfoFromToolEvent(
        "read_file",
        { path: "src/foo.ts" },
        cwd
      );
      expect(info.kind).toBe("read");
      expect(info.locations).toEqual([{ path: `${cwd}/src/foo.ts` }]);
    });

    it("write_file 含 diff + locations", () => {
      const info = toolInfoFromToolEvent(
        "write_file",
        { path: "a.ts", content: "hello" },
        cwd
      );
      expect(info.content).toEqual([
        {
          type: "diff",
          path: `${cwd}/a.ts`,
          oldText: null,
          newText: "hello",
        },
      ]);
      expect(info.locations).toEqual([{ path: `${cwd}/a.ts` }]);
    });

    it("edit_file 用 find/replace 构造 diff", () => {
      const info = toolInfoFromToolEvent(
        "edit_file",
        { path: "b.ts", find: "old", replace: "new" },
        cwd
      );
      expect(info.content?.[0]).toMatchObject({
        type: "diff",
        oldText: "old",
        newText: "new",
      });
    });
  });

  describe("toolUpdateFromToolResult", () => {
    it("read_file 全文 markdownEscape", () => {
      const out = toolUpdateFromToolResult("read_file", "line1\nline2");
      expect(out.rawOutput).toBe("line1\nline2");
      const text = (out.content?.[0] as { content: { text: string } })?.content
        ?.text;
      expect(text).toContain("line1");
      expect(text).toMatch(/^```/);
    });

    it("MCP structuredContent → rawOutput", () => {
      const payload = {
        type: "text",
        text: "Stop.",
        structuredContent: { status: "pending", requestId: "r1" },
      };
      const out = toolUpdateFromToolResult(
        "ask-question__nuwax_ask_question",
        JSON.stringify(payload)
      );
      expect(out.rawOutput).toEqual({ status: "pending", requestId: "r1" });
      expect(out.displayText ?? out.content?.[0]).toBeTruthy();
    });

    it("write_file completed 不重复 diff", () => {
      const out = toolUpdateFromToolResult("write_file", "wrote 3 chars");
      expect(out.content).toBeUndefined();
      expect(out.rawOutput).toBe("wrote 3 chars");
    });

    it("普通对象结果序列化为 JSON，而非 [object Object]", () => {
      const out = toolUpdateFromToolResult(
        "some_tool",
        JSON.stringify({ count: 5, items: [] })
      );
      const text = (out.content?.[0] as { content: { text: string } })?.content
        ?.text;
      expect(text).not.toContain("[object Object]");
      expect(text).toContain('"count"');
    });

    it("read_file 读 JSON 文件保留原始字节（不解析重排，不 [object Object]）", () => {
      const raw = '{"name":"x","version":"1.0.0"}';
      const out = toolUpdateFromToolResult("read_file", raw);
      expect(out.rawOutput).toBe(raw);
      const text = (out.content?.[0] as { content: { text: string } })?.content
        ?.text;
      expect(text).toContain(raw);
      expect(text).not.toContain("[object Object]");
    });
  });

  describe("preserveRawOutput", () => {
    it("解析 JSON 字符串并提取 structuredContent", () => {
      const inner = JSON.stringify({
        structuredContent: { ui: { version: "v2" } },
      });
      expect(preserveRawOutput(inner)).toEqual({ ui: { version: "v2" } });
    });
  });

  describe("markdownEscape", () => {
    it("正文含 ``` 时加长围栏", () => {
      const out = markdownEscape("```js\ncode\n```");
      expect(out.startsWith("````")).toBe(true);
    });
  });

  describe("buildPermissionToolCall", () => {
    it("含 rawInput 与 locations，无 input", () => {
      const tc = buildPermissionToolCall(
        "call_1",
        "read_file",
        { path: "x.ts" },
        cwd
      );
      expect(tc.rawInput).toEqual({ path: "x.ts" });
      expect(tc).not.toHaveProperty("input");
      expect(tc.locations).toBeDefined();
    });
  });
});
