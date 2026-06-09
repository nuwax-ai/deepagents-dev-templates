/**
 * Unit tests for MCPManager
 * Verifies merge strategies, cache invalidation, and validation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MCPManager } from "../../../src/runtime/platform/mcp-manager.js";

describe("MCPManager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mcp-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads default config from a file", () => {
    const configPath = join(tmpDir, "mcp.json");
    writeFileSync(configPath, JSON.stringify({
      servers: {
        context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
      },
    }));

    const manager = new MCPManager({ defaultConfigPath: configPath });
    const servers = manager.listServers();
    expect(servers).toContain("context7");
  });

  it("resolves relative default config paths from an explicit base directory", () => {
    const configDir = join(tmpDir, "config");
    const configPath = join(configDir, "mcp.json");
    mkdirSync(configDir);
    writeFileSync(configPath, JSON.stringify({
      servers: {
        workspace_mcp: { command: "workspace-command" },
      },
    }));

    const manager = new MCPManager({
      defaultConfigPath: "./config/mcp.json",
      baseDir: tmpDir,
    });

    expect(manager.getServer("workspace_mcp")?.command).toBe("workspace-command");
  });

  it("loads inline default MCP servers", () => {
    const manager = new MCPManager({
      defaultConfig: {
        servers: {
          inline: { command: "inline-mcp" },
        },
      },
    });

    expect(manager.getServer("inline")?.command).toBe("inline-mcp");
  });

  it("returns empty list when no default config", () => {
    const manager = new MCPManager({ defaultConfigPath: "/nonexistent.json" });
    expect(manager.listServers()).toEqual([]);
  });

  it("session-wins (default): session config overrides defaults", () => {
    const defaultPath = join(tmpDir, "mcp.json");
    writeFileSync(defaultPath, JSON.stringify({
      servers: {
        default_server: { command: "default" },
      },
    }));

    const manager = new MCPManager({ defaultConfigPath: defaultPath });
    manager.setSessionConfig({
      servers: {
        default_server: { command: "session" },
      },
    });

    const server = manager.getServer("default_server");
    expect(server?.command).toBe("session");
  });

  it("platform-wins: platform config overrides session and defaults", () => {
    const defaultPath = join(tmpDir, "mcp.json");
    writeFileSync(defaultPath, JSON.stringify({
      servers: { srv: { command: "default" } },
    }));

    const manager = new MCPManager({
      defaultConfigPath: defaultPath,
      mergeStrategy: "platform-wins",
    });
    manager.setPlatformConfig({ servers: { srv: { command: "platform" } } });
    manager.setSessionConfig({ servers: { srv: { command: "session" } } });

    expect(manager.getServer("srv")?.command).toBe("platform");
  });

  it("defaults-wins: defaults override everything", () => {
    const defaultPath = join(tmpDir, "mcp.json");
    writeFileSync(defaultPath, JSON.stringify({
      servers: { srv: { command: "default" } },
    }));

    const manager = new MCPManager({
      defaultConfigPath: defaultPath,
      mergeStrategy: "defaults-wins",
    });
    manager.setPlatformConfig({ servers: { srv: { command: "platform" } } });
    manager.setSessionConfig({ servers: { srv: { command: "session" } } });

    expect(manager.getServer("srv")?.command).toBe("default");
  });

  it("cache invalidation on setPlatformConfig", () => {
    const defaultPath = join(tmpDir, "mcp.json");
    writeFileSync(defaultPath, JSON.stringify({
      servers: { srv: { command: "default" } },
    }));

    const manager = new MCPManager({ defaultConfigPath: defaultPath });
    // First call populates cache
    const first = manager.getMergedConfig();
    expect(first.servers.srv?.command).toBe("default");

    // Update platform config
    manager.setPlatformConfig({
      servers: { srv: { command: "platform" }, new_srv: { command: "new" } },
    });

    // After invalidation, should reflect new state
    const second = manager.getMergedConfig();
    expect(second.servers.srv?.command).toBe("platform");
    expect(second.servers.new_srv?.command).toBe("new");
  });

  it("cache invalidation on setSessionConfig", () => {
    const defaultPath = join(tmpDir, "mcp.json");
    writeFileSync(defaultPath, JSON.stringify({
      servers: { srv: { command: "default" } },
    }));

    const manager = new MCPManager({ defaultConfigPath: defaultPath });
    manager.getMergedConfig(); // populate cache

    manager.setSessionConfig({
      servers: { srv: { command: "session" } },
    });

    expect(manager.getServer("srv")?.command).toBe("session");
  });

  it("validate() reports missing servers", () => {
    const defaultPath = join(tmpDir, "mcp.json");
    writeFileSync(defaultPath, JSON.stringify({
      servers: { context7: { command: "npx" } },
    }));

    const manager = new MCPManager({ defaultConfigPath: defaultPath });
    const result = manager.validate(["context7", "missing-server"]);
    expect(result.valid).toBe(false);
    expect(result.missing).toEqual(["missing-server"]);
  });

  it("validate() returns valid when all required servers present", () => {
    const defaultPath = join(tmpDir, "mcp.json");
    writeFileSync(defaultPath, JSON.stringify({
      servers: { a: {}, b: {} },
    }));

    const manager = new MCPManager({ defaultConfigPath: defaultPath });
    const result = manager.validate(["a", "b"]);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("merges multiple layers — adds new servers without dropping existing", () => {
    const defaultPath = join(tmpDir, "mcp.json");
    writeFileSync(defaultPath, JSON.stringify({
      servers: { default_only: { command: "d" } },
    }));

    const manager = new MCPManager({ defaultConfigPath: defaultPath });
    manager.setSessionConfig({
      servers: { session_only: { command: "s" } },
    });

    const merged = manager.getMergedConfig();
    expect(merged.servers.default_only?.command).toBe("d");
    expect(merged.servers.session_only?.command).toBe("s");
  });
});
