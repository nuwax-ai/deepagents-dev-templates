import { describe, expect, it } from "vitest";
import { chooseMcpToolName } from "../mcp-client.js";

describe("chooseMcpToolName", () => {
  it("优先精确匹配 preferred", () => {
    expect(chooseMcpToolName(["search", "vendor_web_search"], "vendor_web_search")).toBe(
      "vendor_web_search"
    );
  });

  it("preferred 不存在时匹配 aliases", () => {
    expect(chooseMcpToolName(["search"], "vendor_web_search", ["search"])).toBe("search");
  });

  it("preferred 不存在时按子串模糊匹配", () => {
    expect(chooseMcpToolName(["web_search"], "vendor_web_search")).toBe("web_search");
  });

  it("只有一个工具时使用该工具", () => {
    expect(chooseMcpToolName(["query"], "vendor_web_search")).toBe("query");
  });

  it("无法解析时抛出可用工具列表", () => {
    expect(() => chooseMcpToolName(["foo", "bar"], "vendor_web_search")).toThrow(
      /可用工具: foo, bar/
    );
  });
});
