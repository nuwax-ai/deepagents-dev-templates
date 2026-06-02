import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { MCPManager } from "../../src/runtime/mcp-manager.js";
import { createMcpBridgeTool } from "../../src/app/tools/mcp-bridge.tool.js";

describe("mcp bridge tool", () => {
  it("calls a command-based MCP server over stdio", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "mcp-bridge-test-"));
    try {
      const configPath = join(tmpDir, "mcp.json");
      writeFileSync(configPath, JSON.stringify({
        servers: {
          fake: {
            command: process.execPath,
            args: [resolve(process.cwd(), "tests/fixtures/fake-mcp-server.mjs")],
          },
        },
      }));

      const manager = new MCPManager({ defaultConfigPath: configPath });
      const bridge = createMcpBridgeTool(manager);

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
