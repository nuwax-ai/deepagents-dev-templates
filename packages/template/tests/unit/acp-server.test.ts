import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/runtime/config-loader.js";
import { buildACPAgentConfig, loadSessionConfigFromEnv } from "../../src/runtime/acp-server.js";
import { createRuntimeContextAsync } from "../../src/runtime/helpers.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("ACP server config", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("uses session prompt and model when building the ACP agent config", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "acp-config-test-"));
    try {
      const sessionConfig = {
        systemPrompt: "Prompt supplied by ACP/platform",
        model: "claude-session-model",
        agentId: "agent-1",
        spaceId: "space-1",
        mcpServers: {
          context7: { command: "context7", args: [] },
        },
      };
      const config = loadConfig({
        configPath: "/nonexistent.json",
        sessionConfig,
      });

      const agentConfig = buildACPAgentConfig(config, workspaceRoot, sessionConfig);

      expect(agentConfig.systemPrompt).toBe("Prompt supplied by ACP/platform");
      expect(typeof agentConfig.model).not.toBe("string");
      expect(agentConfig.tools?.map((tool) => tool.name)).toContain("mcp_tool_bridge");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("loads startup session config from ACP_SESSION_CONFIG_JSON", () => {
    process.env.ACP_SESSION_CONFIG_JSON = JSON.stringify({
      model: "claude-from-env-session",
      agentId: "agent-env",
      spaceId: "space-env",
    });

    expect(loadSessionConfigFromEnv()).toEqual({
      model: "claude-from-env-session",
      agentId: "agent-env",
      spaceId: "space-env",
    });
  });

  it("hydrates platform MCP components and lets session MCP override them", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      components: [
        {
          componentId: "platform-email",
          type: "mcp",
          config: {
            name: "email",
            command: "platform-email",
            args: ["serve"],
          },
        },
        {
          componentId: "platform-docs",
          type: "mcp",
          config: {
            mcpServer: {
              url: "https://mcp.example.test/docs",
            },
          },
        },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const sessionConfig = {
      agentId: "agent-1",
      spaceId: "space-1",
      mcpServers: {
        email: { command: "session-email", args: ["serve"] },
      },
    };
    const config = loadConfig({
      configPath: "/nonexistent.json",
      sessionConfig,
    });

    const context = await createRuntimeContextAsync(config, sessionConfig);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(context.mcpManager.getServer("email")?.command).toBe("session-email");
    expect(context.mcpManager.getServer("platform-docs")?.url).toBe("https://mcp.example.test/docs");
  });
});
