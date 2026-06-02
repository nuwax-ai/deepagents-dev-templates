import { afterEach, describe, expect, it, vi } from "vitest";
import { PlatformClient } from "../../src/runtime/platform-client.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function createClient() {
  return new PlatformClient({
    apiBaseUrl: "https://platform.example.test/",
    agentId: "agent-123",
    spaceId: "space-456",
    authToken: "token",
  });
}

describe("PlatformClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves prompts through the agent config update endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await createClient().savePrompt("target agent prompt", { reason: "test" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://platform.example.test/api/agent/config/update");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer token" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      agentId: "agent-123",
      prompt: "target agent prompt",
      metadata: {
        reason: "test",
        source: "ai-generated",
      },
    });
  });

  it("queries platform components before custom code is written", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ plugins: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await createClient().queryPlugins("email sender", { type: "mcp", limit: 5 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://platform.example.test/api/agent/component/search?q=email+sender&type=mcp&limit=5");
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
  });

  it("executes plugins and workflows through sandbox endpoints", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient();

    await client.executePlugin("plugin-1", { input: "x" });
    await client.executeWorkflow("workflow-1", { input: "y" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://platform.example.test/api/v1/plugin/plugin-1/execute");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      agentId: "agent-123",
      spaceId: "space-456",
      params: { input: "x" },
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://platform.example.test/api/v1/workflow/workflow-1/execute");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      agentId: "agent-123",
      spaceId: "space-456",
      params: { input: "y" },
    });
  });

  it("creates and reads platform debug sessions", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "debug-1",
        agentId: "agent-123",
        status: "active",
        createdAt: "2026-06-02T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: "debug-1",
        agentId: "agent-123",
        status: "completed",
        createdAt: "2026-06-02T00:00:00.000Z",
      }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createClient();

    await client.createDebugSession({
      model: "claude-debug",
      mcpServers: { context7: { command: "npx" } },
    });
    await client.getDebugSession("debug-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://platform.example.test/api/agent/debug/session");
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      agentId: "agent-123",
      spaceId: "space-456",
      model: "claude-debug",
      mcpServers: { context7: { command: "npx" } },
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://platform.example.test/api/agent/debug/session/debug-1");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("GET");
  });

  it("allows nuwaclaw/platform to override endpoint mappings by config", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ plugins: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new PlatformClient({
      apiBaseUrl: "https://platform.example.test",
      agentId: "agent-123",
      spaceId: "space-456",
      endpoints: {
        queryPlugins: {
          method: "POST",
          path: "/custom/component/search",
        },
      },
    });

    await client.queryPlugins("calendar");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://platform.example.test/custom/component/search");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      query: "calendar",
      agentId: "agent-123",
      spaceId: "space-456",
    });
  });

  it("normalizes bound platform MCP components into MCP config", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      components: [
        {
          componentId: "weather-plugin",
          type: "mcp",
          config: {
            name: "weather",
            command: "node",
            args: ["weather-mcp.js"],
            env: { WEATHER_API_KEY: "${WEATHER_API_KEY}" },
          },
        },
        {
          componentId: "docs-plugin",
          type: "mcp",
          config: {
            mcp: {
              servers: {
                docs: {
                  url: "https://mcp.example.test/docs",
                  description: "Docs MCP",
                },
              },
            },
          },
        },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const mcpConfig = await createClient().listMcpServers();

    expect(mcpConfig).toEqual({
      servers: {
        weather: {
          command: "node",
          args: ["weather-mcp.js"],
          env: { WEATHER_API_KEY: "${WEATHER_API_KEY}" },
        },
        docs: {
          url: "https://mcp.example.test/docs",
          description: "Docs MCP",
        },
      },
    });
  });
});
