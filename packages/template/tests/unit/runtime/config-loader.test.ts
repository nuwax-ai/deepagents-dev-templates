/**
 * Unit tests for config-loader
 * Verifies defaults, priority chain, and validation behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
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
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.LLM_PROVIDER;
    delete process.env.ACP_AGENT_NAME;
    delete process.env.PLATFORM_API_BASE_URL;
    delete process.env.PLATFORM_AGENT_ID;
    delete process.env.PLATFORM_SPACE_ID;
    delete process.env.MCP_CONFIG_PATH;
    delete process.env.DEEPAGENTS_CONFIG_PATH;
    delete process.env.APP_AGENT_CONFIG_PATH;
    delete process.env.DEEPAGENTS_BUILTIN_CONFIG;
    delete process.env.LOG_LEVEL;
    delete process.env.ACP_DEBUG;
    delete process.env.DEEPAGENTS_HOME;
    process.env.DEEPAGENTS_HOME = join(tmpDir, "home");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns schema defaults when no config file", async () => {
    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig({ configPath: "/nonexistent-defaults.json" });
    // Schema defaults (file config overrides these)
    expect(config.model.provider).toBe("anthropic");
    expect(config.model.name).toBe("claude-sonnet-4-6");
    expect(config.platform.apiBaseUrl).toBe("https://api.nuwax.com");
    expect(config.skills.directories).toContain("~/.deepagents/skills");
    expect(config.skills.directories).toContain("./.deepagents/skills");
    expect(config.agentsDirectories).toContain("~/.deepagents");
    expect(config.agentsDirectories).toContain("./.deepagents");
  });

  it("loads config from a custom file", async () => {
    const configPath = join(tmpDir, "app.json");
    writeFileSync(configPath, JSON.stringify({
      agent: { name: "my-agent", description: "Test", version: "1.0.0" },
      model: { provider: "openai", name: "gpt-4o" },
    }));
    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig({ configPath });
    expect(config.agent.name).toBe("my-agent");
    expect(config.model.provider).toBe("openai");
    expect(config.model.name).toBe("gpt-4o");
  });

  it("loads the package template config by default, independent of workspace root", async () => {
    const workspaceRoot = join(tmpDir, "workspace");
    mkdirSync(join(workspaceRoot, "config"), { recursive: true });
    writeFileSync(join(workspaceRoot, "config", "app-agent.config.json"), JSON.stringify({
      agent: { name: "workspace-agent" },
    }));

    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig({ workspaceRoot });

    expect(config.agent.name).toBe("my-scenario-agent");
    expect(config.mcp.configPath).toMatch(/packages\/template\/config\/mcp\.default\.json$/);
  });

  it("allows the main config path to be switched with DEEPAGENTS_CONFIG_PATH", async () => {
    const configPath = join(tmpDir, "env-app.json");
    writeFileSync(configPath, JSON.stringify({
      agent: { name: "env-config-agent" },
    }));
    process.env.DEEPAGENTS_CONFIG_PATH = configPath;

    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig();

    expect(config.agent.name).toBe("env-config-agent");
  });

  it("env vars override file config", async () => {
    const configPath = join(tmpDir, "app.json");
    writeFileSync(configPath, JSON.stringify({
      agent: { name: "file-agent" },
    }));
    process.env.ACP_AGENT_NAME = "env-agent";

    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig({ configPath });
    expect(config.agent.name).toBe("env-agent");
  });

  it("maps Anthropic model env vars used by real deployments", async () => {
    process.env.ANTHROPIC_MODEL = "claude-real-env-model";
    process.env.ANTHROPIC_BASE_URL = "https://llm-proxy.example.com";

    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig({ configPath: "/nonexistent.json" });

    expect(config.model.provider).toBe("anthropic");
    expect(config.model.name).toBe("claude-real-env-model");
    expect(config.model.baseUrl).toBe("https://llm-proxy.example.com");
  });

  it("infers openai provider from OPENAI_* env when LLM_PROVIDER is unset", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_BASE_URL = "https://api.example.com/v1";
    process.env.OPENAI_MODEL = "gpt-4o";

    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig({ configPath: "/nonexistent.json" });

    expect(config.model.provider).toBe("openai");
    expect(config.model.name).toBe("gpt-4o");
    expect(config.model.baseUrl).toBe("https://api.example.com/v1");
    expect(config.model.apiKeyEnv).toBe("OPENAI_API_KEY");
  });

  it("honors explicit LLM_PROVIDER over OPENAI_* inference", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_BASE_URL = "https://api.example.com/v1";

    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig({ configPath: "/nonexistent.json" });

    expect(config.model.provider).toBe("anthropic");
  });

  it("session config overrides env vars", async () => {
    process.env.ACP_AGENT_NAME = "env-agent";
    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig({
      sessionConfig: { model: "claude-opus-4-1" },
    });
    // Session can override model
    expect(config.model.name).toBe("claude-opus-4-1");
    // But agent name comes from env (no session override)
    expect(config.agent.name).toBe("env-agent");
  });

  it("handles missing config file gracefully", async () => {
    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig({ configPath: "/nonexistent.json" });
    // Should fall back to file-less defaults — schema defaults apply
    expect(config.model.provider).toBe("anthropic");
  });

  it("handles invalid JSON in config file gracefully", async () => {
    const configPath = join(tmpDir, "bad.json");
    writeFileSync(configPath, "{ not valid json");
    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    // Should not throw — falls back to schema defaults
    const config = loadConfig({ configPath });
    expect(config.model.provider).toBe("anthropic");
  });

  it("ACP_DEBUG=true maps to logging.level=debug", async () => {
    process.env.ACP_DEBUG = "true";
    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig();
    expect(config.logging.level).toBe("debug");
  });

  it("LOG_LEVEL env var sets logging level", async () => {
    process.env.LOG_LEVEL = "warn";
    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig();
    expect(config.logging.level).toBe("warn");
  });

  it("DEEPAGENTS_SANDBOX_PROFILE env var selects sandbox profile", async () => {
    process.env.DEEPAGENTS_SANDBOX_PROFILE = "read-only";
    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig({ configPath: "/nonexistent.json" });
    expect(config.sandbox.profile).toBe("read-only");
  });

  it("MCP_CONFIG_PATH env var sets the default MCP config path", async () => {
    process.env.MCP_CONFIG_PATH = "./config/mcp.custom.json";
    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig();
    expect(config.mcp.configPath).toBe("./config/mcp.custom.json");
  });

  it("platform URLs default to Nuwax", async () => {
    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig();
    expect(config.platform.apiBaseUrl).toBe("https://api.nuwax.com");
  });

  it("loads user, project, template, env, and session layers in order", async () => {
    const userDir = join(tmpDir, "home");
    const projectDir = join(tmpDir, "workspace");
    mkdirSync(join(userDir), { recursive: true });
    mkdirSync(join(projectDir, ".deepagents"), { recursive: true });

    writeFileSync(join(userDir, "config.json"), JSON.stringify({
      agent: { name: "user-agent" },
      skills: { directories: ["~/.deepagents/skills"] },
    }));
    writeFileSync(join(projectDir, ".deepagents", "config.json"), JSON.stringify({
      agent: { name: "project-agent" },
      skills: { directories: ["./.deepagents/skills"] },
    }));
    const templateConfig = join(tmpDir, "template.json");
    writeFileSync(templateConfig, JSON.stringify({
      agent: { name: "template-agent" },
      skills: { directories: ["./skills/builtin"] },
    }));
    process.env.ACP_AGENT_NAME = "env-agent";

    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig({
      configPath: templateConfig,
      workspaceRoot: projectDir,
      sessionConfig: { model: "session-model" },
    });

    expect(config.agent.name).toBe("env-agent");
    expect(config.model.name).toBe("session-model");
    expect(config.skills.directories).toContain("~/.deepagents/skills");
    expect(config.skills.directories).toContain("./.deepagents/skills");
    expect(config.skills.directories).toContain("./skills/builtin");
  });

  it("loads models.json and user/project mcp.json as config layers", async () => {
    const userDir = join(tmpDir, "home");
    const projectDir = join(tmpDir, "workspace");
    mkdirSync(userDir, { recursive: true });
    mkdirSync(join(projectDir, ".deepagents"), { recursive: true });
    writeFileSync(join(userDir, "models.json"), JSON.stringify({
      default: { provider: "openai", name: "gpt-test" },
    }));
    writeFileSync(join(userDir, "mcp.json"), JSON.stringify({ servers: { user: { command: "echo" } } }));
    writeFileSync(join(projectDir, ".deepagents", "mcp.json"), JSON.stringify({ servers: { project: { command: "echo" } } }));

    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig({
      configPath: "/nonexistent.json",
      workspaceRoot: projectDir,
    });

    expect(config.model.provider).toBe("openai");
    expect(config.model.name).toBe("gpt-test");
    expect(config.mcp.configPaths).toContain(join(userDir, "mcp.json"));
    expect(config.mcp.configPaths).toContain(join(projectDir, ".deepagents", "mcp.json"));
  });

  it("uses user-level workingDir to find project .deepagents config", async () => {
    const userDir = join(tmpDir, "home");
    const projectDir = join(tmpDir, "configured-workspace");
    mkdirSync(userDir, { recursive: true });
    mkdirSync(join(projectDir, ".deepagents"), { recursive: true });
    writeFileSync(join(userDir, "config.json"), JSON.stringify({
      workspace: { workingDir: projectDir },
    }));
    writeFileSync(join(projectDir, ".deepagents", "config.json"), JSON.stringify({
      agent: { name: "workspace-agent" },
    }));

    const { loadConfig, resolveConfiguredWorkspaceRoot } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig({ configPath: "/nonexistent.json" });

    expect(resolveConfiguredWorkspaceRoot(config, tmpDir)).toBe(projectDir);
    expect(config.agent.name).toBe("workspace-agent");
  });

  it("loads plugin manifests from user and project plugin directories", async () => {
    const userDir = join(tmpDir, "home");
    const projectDir = join(tmpDir, "workspace");
    const userPlugin = join(userDir, "plugins", "global-plugin");
    const projectPlugin = join(projectDir, ".deepagents", "plugins", "project-plugin");
    mkdirSync(userPlugin, { recursive: true });
    mkdirSync(projectPlugin, { recursive: true });

    writeFileSync(join(userPlugin, "plugin.json"), JSON.stringify({
      id: "global-plugin",
      skillsDirectories: ["skills"],
      agentsDirectories: ["agents-root"],
      mcpServers: {
        globalPluginServer: { command: "global-plugin-mcp" },
      },
    }));
    writeFileSync(join(projectPlugin, "plugin.json"), JSON.stringify({
      id: "project-plugin",
      hooks: [
        {
          event: "pre_tool_use",
          matcher: "^execute$",
          command: "echo ok",
        },
      ],
      mcp: {
        configPath: "mcp.json",
      },
    }));

    const { loadConfig } = await import("../../../src/runtime/config/config-loader.js");
    const config = loadConfig({
      configPath: "/nonexistent.json",
      workspaceRoot: projectDir,
    });

    expect(config.skills.directories).toContain(join(userPlugin, "skills"));
    expect(config.agentsDirectories).toContain(join(userPlugin, "agents-root"));
    expect(config.mcp.servers.globalPluginServer).toEqual({ command: "global-plugin-mcp" });
    expect(config.mcp.configPaths).toContain(join(projectPlugin, "mcp.json"));
    expect(config.hooks.some((hook) => hook.command === "echo ok")).toBe(true);
  });
});
