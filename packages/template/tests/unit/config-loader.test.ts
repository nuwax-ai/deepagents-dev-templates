/**
 * Unit tests for config-loader
 * Verifies defaults, priority chain, and validation behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("config-loader", () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "config-loader-test-"));
    // Clear relevant env vars
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.ACP_AGENT_NAME;
    delete process.env.PLATFORM_API_BASE_URL;
    delete process.env.PLATFORM_AGENT_ID;
    delete process.env.PLATFORM_SPACE_ID;
    delete process.env.MCP_CONFIG_PATH;
    delete process.env.LOG_LEVEL;
    delete process.env.ACP_DEBUG;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns schema defaults when no config file", async () => {
    const { loadConfig } = await import("../../src/runtime/config-loader.js");
    const config = loadConfig({ configPath: "/nonexistent-defaults.json" });
    // Schema defaults (file config overrides these)
    expect(config.model.provider).toBe("anthropic");
    expect(config.model.name).toBe("claude-sonnet-4-6");
    expect(config.platform.apiBaseUrl).toBe("https://api.nuwax.com");
  });

  it("loads config from a custom file", async () => {
    const configPath = join(tmpDir, "app.json");
    writeFileSync(configPath, JSON.stringify({
      agent: { name: "my-agent", description: "Test", version: "1.0.0" },
      model: { provider: "openai", name: "gpt-4o" },
    }));
    const { loadConfig } = await import("../../src/runtime/config-loader.js");
    const config = loadConfig({ configPath });
    expect(config.agent.name).toBe("my-agent");
    expect(config.model.provider).toBe("openai");
    expect(config.model.name).toBe("gpt-4o");
  });

  it("env vars override file config", async () => {
    const configPath = join(tmpDir, "app.json");
    writeFileSync(configPath, JSON.stringify({
      agent: { name: "file-agent" },
    }));
    process.env.ACP_AGENT_NAME = "env-agent";

    const { loadConfig } = await import("../../src/runtime/config-loader.js");
    const config = loadConfig({ configPath });
    expect(config.agent.name).toBe("env-agent");
  });

  it("maps Anthropic model env vars used by real deployments", async () => {
    process.env.ANTHROPIC_MODEL = "claude-real-env-model";
    process.env.ANTHROPIC_BASE_URL = "https://llm-proxy.example.com";

    const { loadConfig } = await import("../../src/runtime/config-loader.js");
    const config = loadConfig({ configPath: "/nonexistent.json" });

    expect(config.model.provider).toBe("anthropic");
    expect(config.model.name).toBe("claude-real-env-model");
    expect(config.model.baseUrl).toBe("https://llm-proxy.example.com");
  });

  it("session config overrides env vars", async () => {
    process.env.ACP_AGENT_NAME = "env-agent";
    const { loadConfig } = await import("../../src/runtime/config-loader.js");
    const config = loadConfig({
      sessionConfig: { model: "claude-opus-4-1" },
    });
    // Session can override model
    expect(config.model.name).toBe("claude-opus-4-1");
    // But agent name comes from env (no session override)
    expect(config.agent.name).toBe("env-agent");
  });

  it("handles missing config file gracefully", async () => {
    const { loadConfig } = await import("../../src/runtime/config-loader.js");
    const config = loadConfig({ configPath: "/nonexistent.json" });
    // Should fall back to file-less defaults — schema defaults apply
    expect(config.model.provider).toBe("anthropic");
  });

  it("handles invalid JSON in config file gracefully", async () => {
    const configPath = join(tmpDir, "bad.json");
    writeFileSync(configPath, "{ not valid json");
    const { loadConfig } = await import("../../src/runtime/config-loader.js");
    // Should not throw — falls back to schema defaults
    const config = loadConfig({ configPath });
    expect(config.model.provider).toBe("anthropic");
  });

  it("ACP_DEBUG=true maps to logging.level=debug", async () => {
    process.env.ACP_DEBUG = "true";
    const { loadConfig } = await import("../../src/runtime/config-loader.js");
    const config = loadConfig();
    expect(config.logging.level).toBe("debug");
  });

  it("LOG_LEVEL env var sets logging level", async () => {
    process.env.LOG_LEVEL = "warn";
    const { loadConfig } = await import("../../src/runtime/config-loader.js");
    const config = loadConfig();
    expect(config.logging.level).toBe("warn");
  });

  it("MCP_CONFIG_PATH env var sets the default MCP config path", async () => {
    process.env.MCP_CONFIG_PATH = "./config/mcp.custom.json";
    const { loadConfig } = await import("../../src/runtime/config-loader.js");
    const config = loadConfig();
    expect(config.mcp.configPath).toBe("./config/mcp.custom.json");
  });

  it("platform URLs default to Nuwax", async () => {
    const { loadConfig } = await import("../../src/runtime/config-loader.js");
    const config = loadConfig();
    expect(config.platform.apiBaseUrl).toBe("https://api.nuwax.com");
  });
});
