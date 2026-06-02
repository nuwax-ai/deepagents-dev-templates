import { describe, expect, it, vi } from "vitest";
import { createPlatformApiTool } from "../../src/app/tools/platform-api.tool.js";
import type { PlatformClient } from "../../src/runtime/platform-client.js";

describe("platform_api tool", () => {
  it("creates and reads debug sessions through PlatformClient", async () => {
    const platformClient = {
      createDebugSession: vi.fn(async () => ({
        id: "debug-1",
        agentId: "agent-1",
        status: "active",
        createdAt: "2026-06-02T00:00:00.000Z",
      })),
      getDebugSession: vi.fn(async () => ({
        id: "debug-1",
        agentId: "agent-1",
        status: "completed",
        createdAt: "2026-06-02T00:00:00.000Z",
      })),
    } as unknown as PlatformClient;

    const tool = createPlatformApiTool(platformClient);

    const created = JSON.parse(String(await tool.invoke({
      operation: "create_debug_session",
      params: {
        model: "claude-debug",
        mcpServers: { context7: { command: "npx" } },
      },
    })));
    const status = JSON.parse(String(await tool.invoke({
      operation: "get_debug_session",
      params: { sessionId: "debug-1" },
    })));

    expect(created.status).toBe("active");
    expect(status.status).toBe("completed");
    expect(platformClient.createDebugSession).toHaveBeenCalledWith({
      model: "claude-debug",
      mcpServers: { context7: { command: "npx" } },
    });
    expect(platformClient.getDebugSession).toHaveBeenCalledWith("debug-1");
  });
});
