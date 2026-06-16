import { describe, expect, it } from "vitest";
import { chooseMcpToolName } from "../mcp-client.js";

describe("chooseMcpToolName", () => {
  it("优先精确匹配 preferred", () => {
    expect(chooseMcpToolName(["search", "duckduckgo_search"], "duckduckgo_search")).toBe(
      "duckduckgo_search"
    );
  });

  it("preferred 不存在时匹配 aliases", () => {
    expect(chooseMcpToolName(["search"], "duckduckgo_search", ["search"])).toBe("search");
  });

  it("aliases 不存在时按 search/duck 模糊匹配", () => {
    expect(chooseMcpToolName(["web_search"], "duckduckgo_search")).toBe("web_search");
  });

  it("只有一个工具时使用该工具", () => {
    expect(chooseMcpToolName(["query"], "duckduckgo_search")).toBe("query");
  });

  it("无法解析时抛出可用工具列表", () => {
    expect(() => chooseMcpToolName(["foo", "bar"], "duckduckgo_search")).toThrow(
      /可用工具: foo, bar/
    );
  });
});
