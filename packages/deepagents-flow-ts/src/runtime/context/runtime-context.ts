/**
 * Runtime Context —— 装配运行时上下文（native MCP 工具 + 合并后的 MCP 配置）。
 *
 * 设计要点：
 * - MCP：合并 default(含 configPath 文件) + session（ACP 下发）
 *   （session-wins：default < session），用 @langchain/mcp-adapters 的
 *   MultiServerMCPClient.getTools() 加载 native MCP 工具。平台 MCP 经 ACP sessionConfig 下发，运行时不主动拉取。
 * - onConnectionError="ignore"：单个 server 连不上只跳过，不炸掉其余 server 的工具。
 * - tools 不由本 context 创建（由 app 层 createFlowTools 组装）。
 */

import type { StructuredTool } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { readFileSync, existsSync } from "node:fs";
import { type AppConfig, type ACPSessionConfig } from "../config/config-loader.js";
import { resolvePath } from "../config/config-paths.js";
import { resolvePackageRoot } from "../package-root.js";
import { logger } from "../logger.js";

/** MCP server 配置（stdio command 或 http url）。 */
export interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

/** mcp-adapters connection 形状（stdio | http）。 */
type McpConnection =
  | { transport: "stdio"; command: string; args: string[]; env?: Record<string, string> }
  | { transport: "http"; url: string };

/**
 * 工具与 agent 依赖的运行时组件集合。
 * 每个 agent 生命周期（bootstrap 或独立工厂调用）创建一次。
 */
export interface RuntimeContext {
  config: AppConfig;
  /** 合并后的 MCP server 配置（default + session，session-wins）。供 mcp-bridge 元工具列/调。 */
  mcpServerConfigs: Record<string, McpServerEntry>;
  /** 经 @langchain/mcp-adapters 从已配置 MCP server 加载的 native LangChain 工具 */
  mcpTools: StructuredTool[];
  /** @internal session MCP overrides（session-wins 最高优先级），hydrate 重新合并时用。 */
  sessionMcpServers: Record<string, McpServerEntry>;
  /** mcp-adapters client（destroy 时 close 以释放 stdio 子进程 / http 连接）。hydrate 前为 null。 */
  mcpClient: MultiServerMCPClient | null;
}

/** 合并 MCP server 配置层：后者覆盖同名（最后一层优先级最高）。 */
function mergeServers(
  ...layers: Record<string, McpServerEntry>[]
): Record<string, McpServerEntry> {
  const merged: Record<string, McpServerEntry> = {};
  for (const layer of layers) {
    for (const [name, cfg] of Object.entries(layer)) {
      if (cfg) merged[name] = cfg;
    }
  }
  return merged;
}

/**
 * 从 config.mcp.servers + configPath/configPaths 指向的文件加载 default MCP servers。
 * 注意:不读 configPath 会丢失 mcp.default.json
 * 里的默认 server（如 context7）。
 *
 * MCP 默认配置属于 Agent 安装包，相对包根解析；ACP session cwd（用户工作区）不参与。
 */
function resolveDefaultMcpServers(config: AppConfig): Record<string, McpServerEntry> {
  const log = logger.child("mcp-default");
  const servers: Record<string, McpServerEntry> = {
    ...((config.mcp.servers as Record<string, McpServerEntry> | undefined) ?? {}),
  };
  // 包根：loadConfig 已将内置配置的相对路径规范为绝对路径；此处用包根兜底未规范化的相对路径。
  const packageRoot = resolvePackageRoot(import.meta.url);
  const paths = [
    config.mcp.configPath,
    ...((config.mcp.configPaths as string[] | undefined) ?? []),
  ].filter((p): p is string => Boolean(p));
  for (const p of paths) {
    const resolved = resolvePath(p, packageRoot);
    if (!existsSync(resolved)) {
      log.warn(`MCP config file not found: ${resolved}`);
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(resolved, "utf8"));
      Object.assign(
        servers,
        (parsed?.servers ?? {}) as Record<string, McpServerEntry>
      );
      log.info(`Loaded MCP config: ${resolved}`, {
        servers: Object.keys(parsed?.servers ?? {}),
      });
    } catch (err) {
      log.error(`Failed to parse MCP config: ${resolved}`, {
        error: String(err),
      });
    }
  }
  return servers;
}

/** 把 server 配置转成 mcp-adapters connection；跳过无 url 且无 command 的无效项。
 *  env 规范化：session/ACP 下发的 env 可能是 array（非法），清洗为 Record<string,string>，
 *  否则单个非法 server 会让 mcp-adapters 整体 Zod 校验失败、连累其余合法 server。 */
function toConnections(
  servers: Record<string, McpServerEntry>
): Record<string, McpConnection> {
  const out: Record<string, McpConnection> = {};
  for (const [name, s] of Object.entries(servers)) {
    if (s.url) {
      out[name] = { transport: "http", url: s.url };
    } else if (s.command) {
      // env 仅保留 plain object 且值为 string；其余形态（array / 非 string 值）一律丢弃。
      const rawEnv = s.env as unknown;
      const cleanEnv: Record<string, string> | undefined =
        rawEnv && typeof rawEnv === "object" && !Array.isArray(rawEnv)
          ? Object.fromEntries(
              Object.entries(rawEnv as Record<string, unknown>)
                .filter(([, v]) => typeof v === "string")
                .map(([k, v]) => [k, v as string])
            )
          : undefined;
      const hasEnv = cleanEnv && Object.keys(cleanEnv).length > 0;
      out[name] = {
        transport: "stdio",
        command: s.command,
        args: s.args ?? [],
        ...(hasEnv ? { env: cleanEnv } : {}),
      };
    }
    // else: 既无 url 又无 command —— 跳过，避免 mcp-adapters Zod 'command: Required'。
  }
  return out;
}

/**
 * 创建运行时上下文：合并 default + session MCP 配置（session-wins）。
 * native MCP 工具在 hydrateRuntimeContext（async）中加载。
 */
export function createRuntimeContext(
  config: AppConfig,
  sessionConfig?: ACPSessionConfig,
  _workspaceRoot?: string
): RuntimeContext {
  const log = logger.child("runtime-context");

  const defaultServers = resolveDefaultMcpServers(config);
  const sessionServers =
    (sessionConfig?.mcpServers as Record<string, McpServerEntry> | undefined) ?? {};
  const mcpServerConfigs = mergeServers(defaultServers, sessionServers);

  log.info("Runtime context created", {
    mcpServers: Object.keys(mcpServerConfigs),
  });

  return {
    config,
    mcpServerConfigs,
    mcpTools: [],
    sessionMcpServers: sessionServers,
    mcpClient: null,
  };
}

/**
 * Hydrate async runtime layers: re-merge MCP under session-wins (default < session),
 * then load native MCP tools via mcp-adapters.
 * 平台 MCP 经 ACP sessionConfig（session/new params.mcpServers）下发，运行时不主动拉取。
 */
export async function hydrateRuntimeContext(
  context: RuntimeContext
): Promise<RuntimeContext> {
  const log = logger.child("runtime-context");

  const defaultServers = resolveDefaultMcpServers(context.config);
  context.mcpServerConfigs = mergeServers(defaultServers, context.sessionMcpServers);

  // Load native MCP tools via mcp-adapters; onConnectionError=ignore so a single
  // unreachable server does not zero out all MCP tools.
  const connections = toConnections(context.mcpServerConfigs);
  const connNames = Object.keys(connections);
  if (connNames.length > 0) {
    try {
      const client = new MultiServerMCPClient({
        mcpServers: connections,
        onConnectionError: "ignore",
      } as never);
      context.mcpClient = client;
      context.mcpTools = await client.getTools();
      log.info("Loaded MCP tools", { count: context.mcpTools.length });
    } catch (err) {
      log.warn("MCP bulk load failed; retrying per-server", {
        error: err instanceof Error ? err.message : String(err),
      });
      const tools: typeof context.mcpTools = [];
      for (const name of connNames) {
        try {
          const single = new MultiServerMCPClient({
            mcpServers: { [name]: connections[name] },
            onConnectionError: "ignore",
          } as never);
          tools.push(...(await single.getTools()));
        } catch (e) {
          log.warn("MCP server skipped", {
            server: name,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      context.mcpTools = tools;
      log.info("Loaded MCP tools (per-server fallback)", { count: tools.length });
    }
  }

  return context;
}

export async function createRuntimeContextAsync(
  config: AppConfig,
  sessionConfig?: ACPSessionConfig,
  workspaceRoot?: string
): Promise<RuntimeContext> {
  return await hydrateRuntimeContext(createRuntimeContext(config, sessionConfig, workspaceRoot));
}

/**
 * Tear down runtime resources: close the mcp-adapters client to release stdio
 * child processes / http connections. Safe to call multiple times.
 */
export async function destroyRuntimeContext(context: RuntimeContext): Promise<void> {
  if (context.mcpClient) {
    try {
      await (context.mcpClient as { close?: () => Promise<void> }).close?.();
    } catch {
      // best-effort teardown
    }
  }
}
