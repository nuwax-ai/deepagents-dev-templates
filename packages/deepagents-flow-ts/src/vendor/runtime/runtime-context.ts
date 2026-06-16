/**
 * Runtime Context (vendored from deepagents-app-ts)
 *
 * 相对原版的改动（flow-ts 去 app-ts 依赖）：
 * - MCP 不再用 MCPManager：合并 default(含 configPath 文件) + platform + session
 *   （session-wins：default < platform < session），用 @langchain/mcp-adapters 的
 *   MultiServerMCPClient.getTools() 加载 native MCP 工具。
 * - onConnectionError="warn"：单个 server 连不上只告警，不炸掉其余 server 的工具。
 * - 不再调用 createTools：tools 不由本 context 创建（flow-ts 的 createFlowTools 自创建）。
 */

import type { StructuredTool } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { type AppConfig, type ACPSessionConfig } from "./config/config-loader.js";
import { PlatformClient } from "./platform/platform-client.js";
import { VariableManager } from "./platform/variable-manager.js";
import { logger } from "./logger.js";

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
 * The set of runtime components that tools and the agent depend on.
 * Created once per agent lifecycle (bootstrap or standalone factory call).
 */
export interface RuntimeContext {
  config: AppConfig;
  /** PlatformClient when platform credentials are configured, null in local-only mode */
  platformClient: PlatformClient | null;
  variableManager: VariableManager;
  /** 合并后的 MCP server 配置（default + platform + session，session-wins）。供 mcp-bridge 元工具列/调。 */
  mcpServerConfigs: Record<string, McpServerEntry>;
  /** MCP tools loaded from configured MCP servers via @langchain/mcp-adapters (native LangChain tools) */
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
 * 对照原 app-ts MCPManager.loadDefaultConfig —— 不读 configPath 会丢失 mcp.default.json
 * 里的默认 server（如 context7）。
 */
function resolveDefaultMcpServers(config: AppConfig): Record<string, McpServerEntry> {
  const log = logger.child("mcp-default");
  const servers: Record<string, McpServerEntry> = {
    ...((config.mcp.servers as Record<string, McpServerEntry> | undefined) ?? {}),
  };
  const paths = [
    config.mcp.configPath,
    ...((config.mcp.configPaths as string[] | undefined) ?? []),
  ].filter((p): p is string => Boolean(p));
  for (const p of paths) {
    const resolved = resolve(process.cwd(), p);
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

/** 把 server 配置转成 mcp-adapters connection；跳过无 url 且无 command 的无效项。 */
function toConnections(
  servers: Record<string, McpServerEntry>
): Record<string, McpConnection> {
  const out: Record<string, McpConnection> = {};
  for (const [name, s] of Object.entries(servers)) {
    if (s.url) {
      out[name] = { transport: "http", url: s.url };
    } else if (s.command) {
      out[name] = {
        transport: "stdio",
        command: s.command,
        args: s.args ?? [],
        ...(s.env ? { env: s.env } : {}),
      };
    }
    // else: 既无 url 又无 command —— 跳过，避免 mcp-adapters Zod 'command: Required'。
  }
  return out;
}

/**
 * Create the runtime context: PlatformClient (optional), VariableManager, and the
 * merged MCP server config (default + session). Platform MCP is fetched and merged
 * in hydrateRuntimeContext (async) under session-wins ordering.
 */
export function createRuntimeContext(
  config: AppConfig,
  sessionConfig?: ACPSessionConfig,
  _workspaceRoot?: string
): RuntimeContext {
  const log = logger.child("runtime-context");

  const agentId = config.platform.agentId || sessionConfig?.agentId || "";
  const spaceId = config.platform.spaceId || sessionConfig?.spaceId || "";

  const hasPlatform = !!(agentId && spaceId);
  const platformClient = hasPlatform
    ? new PlatformClient({
        apiBaseUrl: config.platform.apiBaseUrl,
        agentId,
        spaceId,
        authToken: process.env.PLATFORM_API_TOKEN,
        endpoints: config.platform.endpoints,
      })
    : null;

  if (!hasPlatform) {
    log.info("Platform credentials not provided — running in local-only mode");
  }

  const variableManager = new VariableManager({ platformClient: platformClient ?? undefined });

  const defaultServers = resolveDefaultMcpServers(config);
  const sessionServers =
    (sessionConfig?.mcpServers as Record<string, McpServerEntry> | undefined) ?? {};
  // create 阶段（尚无 platform）：default < session
  const mcpServerConfigs = mergeServers(defaultServers, sessionServers);

  log.info("Runtime context created", {
    mode: hasPlatform ? "platform" : "local",
    agentId: agentId || "(none)",
    mcpServers: Object.keys(mcpServerConfigs),
  });

  return {
    config,
    platformClient,
    variableManager,
    mcpServerConfigs,
    mcpTools: [],
    sessionMcpServers: sessionServers,
    mcpClient: null,
  };
}

/**
 * Hydrate async runtime layers: fetch platform MCP, re-merge under session-wins
 * (default < platform < session), then load native MCP tools via mcp-adapters.
 * onConnectionError="warn" so one bad server does not drop the rest.
 */
export async function hydrateRuntimeContext(
  context: RuntimeContext
): Promise<RuntimeContext> {
  const log = logger.child("runtime-context");

  // Fetch platform-delivered MCP servers.
  let platformServers: Record<string, McpServerEntry> = {};
  if (context.platformClient) {
    try {
      const platformMcp = await context.platformClient.listMcpServers();
      if (platformMcp?.servers && Object.keys(platformMcp.servers).length > 0) {
        platformServers = platformMcp.servers as Record<string, McpServerEntry>;
        log.info("Hydrated platform MCP config", {
          servers: Object.keys(platformServers),
        });
      }
    } catch (err) {
      log.warn("Failed to hydrate platform MCP config; continuing with default/session MCP only", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // session-wins: default < platform < session（session 覆盖同名，优先级最高）。
  const defaultServers = resolveDefaultMcpServers(context.config);
  context.mcpServerConfigs = mergeServers(
    defaultServers,
    platformServers,
    context.sessionMcpServers
  );

  // Load native MCP tools via mcp-adapters; onConnectionError=warn so a single
  // unreachable server does not zero out all MCP tools.
  try {
    const names = Object.keys(context.mcpServerConfigs);
    if (names.length > 0) {
      const client = new MultiServerMCPClient({
        mcpServers: toConnections(context.mcpServerConfigs),
        onConnectionError: "warn",
      } as never);
      context.mcpClient = client;
      context.mcpTools = await client.getTools();
      log.info("Loaded MCP tools", { count: context.mcpTools.length });
    }
  } catch (err) {
    log.warn("Failed to load MCP tools; continuing with builtin tools only", {
      error: err instanceof Error ? err.message : String(err),
    });
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
