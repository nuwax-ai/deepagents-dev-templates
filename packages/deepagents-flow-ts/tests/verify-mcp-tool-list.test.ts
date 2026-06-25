import { describe, expect, it, vi } from "vitest";
import { verifyMcpServersWithToolList } from "../src/runtime/mcp/verify-mcp-tool-list.js";

describe("verifyMcpServersWithToolList", () => {
  it("getClient 为空则跳过", async () => {
    const client = {
      getClient: vi.fn().mockResolvedValue(undefined),
    };
    const out = await verifyMcpServersWithToolList(client as never, ["missing"]);
    expect(out).toEqual({});
  });

  it("listTools 成功则写入工具名", async () => {
    const client = {
      getClient: vi.fn().mockResolvedValue({
        listTools: vi.fn().mockResolvedValue({
          tools: [{ name: "tool_workflow_732" }, { name: "other" }],
        }),
      }),
    };
    const out = await verifyMcpServersWithToolList(client as never, ["gateway"]);
    expect(out).toEqual({ gateway: ["tool_workflow_732", "other"] });
  });

  it("listTools 抛错则不写入", async () => {
    const client = {
      getClient: vi.fn().mockResolvedValue({
        listTools: vi.fn().mockRejectedValue(new Error("connection closed")),
      }),
    };
    const out = await verifyMcpServersWithToolList(client as never, ["bad"]);
    expect(out).toEqual({});
  });

  it("listTools 返回空数组仍视为已连接", async () => {
    const client = {
      getClient: vi.fn().mockResolvedValue({
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
      }),
    };
    const out = await verifyMcpServersWithToolList(client as never, ["empty"]);
    expect(out).toEqual({ empty: [] });
  });
});
