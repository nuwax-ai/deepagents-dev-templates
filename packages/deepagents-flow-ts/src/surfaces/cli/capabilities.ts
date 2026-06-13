/**
 * flow capabilities —— 输出能力分层 + 可用工具/MCP/skills（供开发 Agent 查询配置）。
 *
 * 静态解析（不加载 MCP server、不需要凭证、不 spawn）：读 config + mcp.default.json
 * + .nuwax-agent/capability-sources.json，输出结构化 JSON。
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { loadFlowConfig } from "../../runtime/config.js";

const BUILTIN_TOOLS = [
  { name: "bash", layer: "agent-builtin", desc: "shell 执行（cwd=workspace，受 sandbox 约束）" },
  { name: "read_file", layer: "agent-builtin", desc: "读取文件（限 workspace）" },
  { name: "write_file", layer: "agent-builtin", desc: "写入文件（受 sandbox 写权限）" },
  { name: "edit_file", layer: "agent-builtin", desc: "查找替换编辑" },
  { name: "grep", layer: "agent-builtin", desc: "正则搜索文件内容" },
  { name: "glob", layer: "agent-builtin", desc: "按 glob 列文件" },
  { name: "http_request", layer: "agent-builtin", desc: "HTTP 调用（复用 app-ts）" },
  { name: "json_utils", layer: "agent-builtin", desc: "JSON 解析/校验/合并（复用 app-ts）" },
  { name: "mcp_tool_bridge", layer: "agent-builtin", desc: "列出/调用任意 MCP server 工具" },
  { name: "platform_api", layer: "agent-builtin", desc: "nuwax 平台 API（查询组件/保存 prompt/读写变量）" },
  { name: "agent_variable", layer: "agent-builtin", desc: "agent 变量读写（放 API key/config）" },
  { name: "echo", layer: "agent-builtin", desc: "demo：回显（无凭证 fallback）" },
  { name: "calculate", layer: "agent-builtin", desc: "demo：算术求值" },
  { name: "time", layer: "agent-builtin", desc: "demo：当前时间" },
];

function readJson<T>(path: string): T | null {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    /* ignore */
  }
  return null;
}

export async function runCapabilities(): Promise<void> {
  const { appConfig, configPath } = loadFlowConfig();
  const pkgRoot = dirname(dirname(configPath));

  const mcpPath = resolve(pkgRoot, appConfig.mcp.configPath);
  const mcpDefault = readJson<{ servers?: Record<string, unknown> }>(mcpPath);
  const mcpServers = mcpDefault?.servers ?? {};

  const capabilitySources = readJson<unknown>(
    join(pkgRoot, ".nuwax-agent", "capability-sources.json")
  );

  const result = {
    agent: appConfig.agent.name,
    description: appConfig.agent.description,
    model: { provider: appConfig.model.provider, name: appConfig.model.name },
    builtinTools: BUILTIN_TOOLS,
    mcpServers,
    skillsDirectories: appConfig.skills.directories,
    agentsDirectories: appConfig.agentsDirectories,
    sandbox: { profile: appConfig.sandbox.profile, writablePaths: appConfig.sandbox.writablePaths },
    compaction: {
      enabled: appConfig.compaction.enabled,
      contextWindow: appConfig.compaction.contextWindow,
      triggerThreshold: appConfig.compaction.triggerThreshold,
    },
    memoryDir: appConfig.memory.dir,
    capabilitySources,
  };

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
