/**
 * MCP 配置路径单测 —— 用户 workspace cwd 与 Agent 包根分离时，默认 MCP 仍从包内加载。
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadFlowConfig } from "../src/runtime/flow-config.js";
import { createRuntimeContext } from "../src/runtime/context/runtime-context.js";
import { resolvePackageRoot } from "../src/runtime/package-root.js";
import { resolveBuiltinTemplateConfig } from "../src/runtime/config/config-paths.js";

const ALIEN_WORKSPACE = "/tmp/deepagents-flow-ts-alien-workspace-test";

describe("resolvePackageRoot", () => {
  it("定位到含 config/flow-agent.config.json 的包根", () => {
    const root = resolvePackageRoot(import.meta.url);
    expect(existsSync(resolve(root, "config/flow-agent.config.json"))).toBe(true);
    expect(existsSync(resolve(root, "config/mcp.default.json"))).toBe(true);
  });
});

describe("loadFlowConfig + MCP 默认路径", () => {
  it("ACP 用户 workspace 与包根不同时，mcp.configPath 仍指向包内 mcp.default.json", () => {
    const pkgRoot = resolvePackageRoot(import.meta.url);
    const { appConfig, configPath } = loadFlowConfig({ workspaceRoot: ALIEN_WORKSPACE });

    const builtin = resolveBuiltinTemplateConfig("flowAgent");
    expect(configPath).toBe(builtin.path);
    expect(appConfig.mcp.configPath).toBe(resolve(pkgRoot, "config/mcp.default.json"));
    expect(existsSync(appConfig.mcp.configPath)).toBe(true);
  });
});

describe("createRuntimeContext 默认 MCP servers", () => {
  it("用户 workspace cwd 不在包根时，仍合并 context7 等默认 server", () => {
    const { appConfig } = loadFlowConfig({ workspaceRoot: ALIEN_WORKSPACE });
    const ctx = createRuntimeContext(appConfig, { cwd: ALIEN_WORKSPACE });
    expect(ctx.mcpServerConfigs.context7).toMatchObject({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
    });
  });

  it("ACP session 下发的 mcpServers 与默认合并（session-wins 同名覆盖）", () => {
    const { appConfig } = loadFlowConfig({ workspaceRoot: ALIEN_WORKSPACE });
    const ctx = createRuntimeContext(appConfig, {
      cwd: ALIEN_WORKSPACE,
      mcpServers: {
        context7: { command: "echo", args: ["acp-override"] },
        whois: { command: "npx", args: ["-y", "@whois-mcp/example"] },
      },
    });
    expect(Object.keys(ctx.mcpServerConfigs).sort()).toEqual(
      ["context7", "whois"].sort()
    );
    expect(ctx.mcpServerConfigs.context7).toMatchObject({
      command: "echo",
      args: ["acp-override"],
    });
    expect(ctx.mcpServerConfigs.whois).toMatchObject({
      command: "npx",
      args: ["-y", "@whois-mcp/example"],
    });
  });
});
