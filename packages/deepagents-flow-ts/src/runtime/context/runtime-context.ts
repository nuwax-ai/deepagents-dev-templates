/**
 * Runtime Context —— 装配运行时上下文（native MCP 工具 + 合并后的 MCP 配置）。
 *
 * 设计要点：
 * - MCP：合并 default(含 configPath 文件) + session（ACP 下发）
 *   （session-wins：default < session），用 @langchain/mcp-adapters 的
 *   MultiServerMCPClient.getTools() 加载 native MCP 工具。平台 MCP 经 ACP sessionConfig 下发，运行时不主动拉取。
 * - onConnectionError=per-server handler：单个 server 连不上记录原因并跳过（不炸其余 server），
 *   启动日志列 connected/failed；stdio 默认挂 restart 供长驻 server（chrome-devtools 等）崩溃自愈。
 * - tools 不由本 context 创建（由 app 层 createFlowTools 组装）。
 */

import type { StructuredTool } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { readFileSync, existsSync } from "node:fs";
import { type AppConfig, type ACPSessionConfig } from "../config/config-loader.js";
import { resolvePath } from "../config/config-paths.js";
import { resolvePackageRoot } from "../package-root.js";
import { logger } from "../logger.js";

/** stdio 进程退出后自动重启配置（chrome-devtools 等长驻 server 崩溃自愈）。 */
export interface McpRestartOpts {
  enabled: boolean;
  maxAttempts?: number;
  delayMs?: number;
}
/** sse 断线自动重连配置。 */
export interface McpReconnectOpts {
  enabled: boolean;
  maxAttempts?: number;
  delayMs?: number;
}

/**
 * MCP server 配置（多 transport：stdio / Streamable HTTP / SSE）。
 * 省略 transport 时按字段推断：有 url→http，有 command→stdio；显式 transport:"sse" 走 SSE。
 */
export interface McpServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  /** 显式 transport；省略则按 url/command 推断。 */
  transport?: "stdio" | "sse" | "http";
  /** http/sse 自定义请求头（如 Authorization）。 */
  headers?: Record<string, string>;
  /** stdio 进程退出后自动重启（默认对 stdio 开启，见 toConnections）。 */
  restart?: McpRestartOpts;
  /** sse 断线自动重连。 */
  reconnect?: McpReconnectOpts;
  /** 该 server 所有工具的默认超时（ms）。 */
  defaultToolTimeout?: number;
}

/** mcp-adapters connection 形状（stdio | http(Streamable) | sse）。 */
type McpConnection =
  | {
      transport: "stdio";
      command: string;
      args: string[];
      env?: Record<string, string>;
      restart?: McpRestartOpts;
      defaultToolTimeout?: number;
    }
  | {
      transport: "sse";
      url: string;
      headers?: Record<string, string>;
      reconnect?: McpReconnectOpts;
      defaultToolTimeout?: number;
    }
  | {
      transport: "http";
      url: string;
      headers?: Record<string, string>;
      automaticSSEFallback?: boolean;
      defaultToolTimeout?: number;
    };

/** stdio connection 默认重启策略（长驻 MCP server 进程意外退出时自愈）。 */
const DEFAULT_STDIO_RESTART: McpRestartOpts = {
  enabled: true,
  maxAttempts: 3,
  delayMs: 1000,
};

/**
 * 规范化 headers：只保留 plain object 且值为 string（ACP/session 下发可能是脏数据，
 * 如 array）。与 env 清洗同理——避免单个非法 server 让 mcp-adapters 整体 Zod 失败。
 */
function cleanHeaders(
  raw: unknown
): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * 工具与 agent 依赖的运行时组件集合。
 * 每个 agent 生命周期（bootstrap 或独立工厂调用）创建一次。
 */
export interface RuntimeContext {
  config: AppConfig;
  /** 合并后的 MCP server 配置（default + session，session-wins）。图内检索节点无注入 client 时 fallback 自管用。 */
  mcpServerConfigs: Record<string, McpServerEntry>;
  /** 经 @langchain/mcp-adapters 从已配置 MCP server 加载的 native LangChain 工具（agent 工具来源）。 */
  mcpTools: StructuredTool[];
  /** @internal session MCP overrides（session-wins 最高优先级），hydrate 重新合并时用。 */
  sessionMcpServers: Record<string, McpServerEntry>;
  /**
   * mcp-adapters 主 client（bulk 模式，session 内持久复用）；destroy 时 close。
   * hydrate 前或 bulk 失败走 per-server fallback 时为 null（此时用 mcpFallbackClients）。
   * 图内检索节点优先经它 getClient(server) 调任意 MCP 工具。
   */
  mcpClient: MultiServerMCPClient | null;
  /** @internal bulk 失败时逐 server 加载的 clients，destroy 时一并 close（修复旧 fallback 泄漏）。 */
  mcpFallbackClients?: MultiServerMCPClient[];
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
    const headers = cleanHeaders(s.headers);
    const timeout =
      typeof s.defaultToolTimeout === "number" ? s.defaultToolTimeout : undefined;

    if (s.transport === "sse" && s.url) {
      // 显式 SSE（旧 server 或需强制 SSE）。
      out[name] = {
        transport: "sse",
        url: s.url,
        ...(headers ? { headers } : {}),
        ...(s.reconnect ? { reconnect: s.reconnect } : {}),
        ...(timeout ? { defaultToolTimeout: timeout } : {}),
      };
    } else if (s.url) {
      // Streamable HTTP（官方自动 SSE fallback；给 url 即识别为 http）。
      out[name] = {
        transport: "http",
        url: s.url,
        ...(headers ? { headers } : {}),
        ...(timeout ? { defaultToolTimeout: timeout } : {}),
      };
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
      // stdio 默认挂 restart（配置显式给 restart 则尊重配置，含 enabled:false）。
      const restart = s.restart ?? DEFAULT_STDIO_RESTART;
      out[name] = {
        transport: "stdio",
        command: s.command,
        args: s.args ?? [],
        ...(hasEnv ? { env: cleanEnv } : {}),
        restart,
        ...(timeout ? { defaultToolTimeout: timeout } : {}),
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
    mcpFallbackClients: [],
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

  const connections = toConnections(context.mcpServerConfigs);
  const connNames = Object.keys(connections);
  context.mcpFallbackClients = [];

  // 配置非法（无 url/command，或 transport=sse 缺 url）的 server 在 toConnections 被静默丢弃——
  // 显式记录，避免「server 消失」无从排查。
  const dropped = Object.keys(context.mcpServerConfigs).filter((n) => !connections[n]);
  if (dropped.length > 0) {
    log.warn("MCP server 配置无效（无 url/command 或 transport=sse 缺 url），已跳过", { dropped });
  }

  if (connNames.length === 0) {
    return context;
  }

  // per-server handler：单个 server 连不上记录原因并跳过（不 throw = ignore 该 server，其余继续）。
  const failed: Array<{ server: string; reason: string }> = [];
  const onConnectionError = ({
    serverName,
    error,
  }: {
    serverName: string;
    error: unknown;
  }) => {
    const reason = error instanceof Error ? error.message : String(error);
    if (!failed.some((f) => f.server === serverName)) {
      failed.push({ server: serverName, reason });
    }
    log.warn("MCP server 连接失败，已跳过", { server: serverName, error: reason });
  };

  try {
    const client = new MultiServerMCPClient({
      mcpServers: connections,
      onConnectionError,
      // 工具名带 server 前缀（如 chrome-devtools__new_page），让 agent 识别 MCP 工具来源、
      // 选对工具，避免在「打开 chrome-devtools」类指令下盲目探索。
      prefixToolNameWithServerName: true,
    } as never);
    context.mcpClient = client;
    context.mcpTools = await client.getTools();
  } catch (err) {
    // bulk 整体抛（如 Zod 校验失败）→ 逐 server 隔离重试，避免单个非法 server 连累全部。
    log.warn("MCP bulk load failed; retrying per-server", {
      error: err instanceof Error ? err.message : String(err),
    });
    failed.length = 0;
    const tools: typeof context.mcpTools = [];
    const fallbackClients: MultiServerMCPClient[] = [];
    for (const name of connNames) {
      try {
        const single = new MultiServerMCPClient({
          mcpServers: { [name]: connections[name] },
          onConnectionError,
          prefixToolNameWithServerName: true,
        } as never);
        tools.push(...(await single.getTools()));
        fallbackClients.push(single); // 保留到 session 结束（工具持有其连接，close 会让工具失效）
      } catch (e) {
        failed.push({
          server: name,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
    context.mcpTools = tools;
    context.mcpClient = null;
    context.mcpFallbackClients = fallbackClients;
  }

  const connected = connNames.filter((n) => !failed.some((f) => f.server === n));
  log.info("Loaded MCP tools", {
    total: context.mcpTools.length,
    connectedServers: connected,
    failedServers: failed,
    mode: context.mcpClient ? "bulk" : "per-server-fallback",
  });

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
 * Tear down runtime resources: close the mcp-adapters client(s) to release stdio
 * child processes / http connections（含 per-server fallback 的 clients）。Safe to call multiple times.
 */
export async function destroyRuntimeContext(context: RuntimeContext): Promise<void> {
  const log = logger.child("runtime-context");
  const clients = [
    context.mcpClient,
    ...(context.mcpFallbackClients ?? []),
  ].filter((c): c is MultiServerMCPClient => Boolean(c));
  if (clients.length === 0) return;
  const servers = Object.keys(context.mcpServerConfigs);
  let closed = 0;
  for (const c of clients) {
    try {
      await (c as { close?: () => Promise<void> }).close?.();
      closed++;
    } catch {
      // best-effort teardown
    }
  }
  context.mcpClient = null;
  context.mcpFallbackClients = [];
  log.info("MCP client closed", { servers, clientsClosed: closed });
}
