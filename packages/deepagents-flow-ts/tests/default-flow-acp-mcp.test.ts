/**
 * 默认 flow + ACP session MCP —— 合并后的 server 经 createFlowTools 进入默认 ReAct 图。
 *
 * 不 spawn 真实 MCP 子进程：只验证 mcp_tool_bridge 读到合并后的 mcpServerConfigs，
 * 以及 default recipe 的 buildGraph 接受含 bridge 的 allTools。
 */

import { describe, it, expect } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { loadFlowConfig } from "../src/runtime/flow-config.js";
import { createRuntimeContext } from "../src/runtime/context/runtime-context.js";
import { createFlowTools } from "../src/app/flow-tools.js";
import { getFlowSandboxPolicy } from "../src/runtime/fs/sandbox.js";
import { recipe } from "../src/app/default-flow.js";
import type { FlowRuntime } from "../src/runtime/flow-runtime.js";
import { createFileCheckpointer } from "../src/runtime/services/file-checkpoint-saver.js";

const ALIEN_WORKSPACE = "/tmp/deepagents-flow-ts-default-flow-acp-mcp";

describe("默认 flow：ACP session mcpServers → 工具集", () => {
  it("mcp_tool_bridge list_servers 含默认 context7 + ACP 下发 server", async () => {
    const { appConfig } = loadFlowConfig({ workspaceRoot: ALIEN_WORKSPACE });
    const ctx = createRuntimeContext(appConfig, {
      cwd: ALIEN_WORKSPACE,
      mcpServers: {
        time: { command: "npx", args: ["-y", "@modelcontextprotocol/server-time"] },
      },
    });
    const policy = getFlowSandboxPolicy(appConfig);
    const allTools = createFlowTools(ctx, {
      workspaceRoot: ALIEN_WORKSPACE,
      policy,
    });
    const bridge = allTools.find((t) => t.name === "mcp_tool_bridge");
    expect(bridge).toBeDefined();

    const listed = JSON.parse(
      String(await bridge!.invoke({ operation: "list_servers" }))
    ) as string[];
    expect(listed).toContain("context7");
    expect(listed).toContain("time");
  });

  it("default recipe buildGraph 接受含 ACP 合并工具集的 runtime.allTools", () => {
    const { appConfig } = loadFlowConfig({ workspaceRoot: ALIEN_WORKSPACE });
    const ctx = createRuntimeContext(appConfig, {
      cwd: ALIEN_WORKSPACE,
      mcpServers: { whois: { command: "echo", args: ["stub"] } },
    });
    const policy = getFlowSandboxPolicy(appConfig);
    const allTools = createFlowTools(ctx, {
      workspaceRoot: ALIEN_WORKSPACE,
      policy,
    });
    const runtime = {
      config: appConfig,
      ctx,
      allTools,
      systemPrompt: "test",
      skillsPaths: [],
      skills: [],
      subAgents: [],
      sandbox: policy,
      workspaceRoot: ALIEN_WORKSPACE,
      checkpointer: createFileCheckpointer(appConfig, ALIEN_WORKSPACE),
    } satisfies FlowRuntime;

    const graph = recipe(runtime).buildGraph(new MemorySaver());
    expect(graph).toBeDefined();
    expect(allTools.some((t) => t.name === "mcp_tool_bridge")).toBe(true);
  });
});
