import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MCPManager } from "../../../../src/runtime/platform/mcp-manager.js";
import { createMcpBridgeTool } from "../../../../src/app/tools/mcp-bridge.tool.js";

describe("mcp bridge tool", () => {
  function createFakeManager(tmpDir: string): MCPManager {
    const configPath = join(tmpDir, "mcp.json");
    writeFileSync(configPath, JSON.stringify({
      servers: {
        fake: {
          command: process.execPath,
          args: [resolve(process.cwd(), "tests/fixtures/fake-mcp-server.mjs")],
        },
      },
    }));
    return new MCPManager({ defaultConfigPath: configPath });
  }

  it("lists tools from a command-based MCP server over stdio", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mcp-bridge-test-"));
    try {
      const bridge = createMcpBridgeTool(createFakeManager(tmpDir));

      const raw = await bridge.invoke({
        operation: "list_tools",
        server: "fake",
      });
      const parsed = JSON.parse(String(raw));

      expect(parsed.status).toBe("ok");
      expect(parsed.server).toBe("fake");
      expect(parsed.result.tools[0].name).toBe("echo");
      expect(parsed.result.tools[0].inputSchema.required).toEqual(["value"]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("calls a command-based MCP server over stdio", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mcp-bridge-test-"));
    try {
      const bridge = createMcpBridgeTool(createFakeManager(tmpDir));

      const raw = await bridge.invoke({
        operation: "call_tool",
        server: "fake",
        toolName: "echo",
        args: { value: 42 },
      });
      const parsed = JSON.parse(String(raw));

      expect(parsed.status).toBe("ok");
      expect(parsed.server).toBe("fake");
      expect(parsed.tool).toBe("echo");
      expect(parsed.result.content[0].type).toBe("text");
      expect(JSON.parse(parsed.result.content[0].text)).toEqual({
        tool: "echo",
        arguments: { value: 42 },
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
