/**
 * ACP MCP Adapter
 *
 * Converts MCP server configurations from the ACP protocol format
 * (passed by IDE clients like Zed/JetBrains in NewSessionRequest.mcpServers)
 * to the MCPManager config format.
 *
 * This is a standalone module so it can be tested and reused independently.
 */

import type { MCPConfig, MCPServerConfig, MCPManager } from "./mcp-manager.js";
import { logger } from "../logger.js";

// ─── ACP MCP Server Types ───────────────────────────────

/** Stdio-based MCP server from ACP protocol */
interface AcpStdioMcpServer {
  name: string;
  command: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
}

/** HTTP/SSE-based MCP server from ACP protocol */
interface AcpHttpMcpServer {
  name: string;
  type: "http" | "sse";
  url: string;
  headers?: Array<{ name: string; value: string }>;
}

type AcpMcpServer = AcpStdioMcpServer | AcpHttpMcpServer;

// ─── Conversion ─────────────────────────────────────────

/**
 * Convert ACP mcpServers array to MCPManager config format.
 *
 * ACP format (from NewSessionRequest):
 *   Stdio: { name, command, args, env?: [{name, value}] }
 *   HTTP:  { name, type: "http"|"sse", url, headers?: [{name, value}] }
 *
 * MCPManager format:
 *   { servers: { [name]: { command?, args?, url?, env? } } }
 */
export function convertAcpMcpServers(
  mcpServers: AcpMcpServer[]
): MCPConfig {
  const log = logger.child("mcp-acp-adapter");
  const servers: Record<string, MCPServerConfig> = {};

  for (const server of mcpServers) {
    if (!server || typeof server !== "object") continue;
    const name = server.name;
    if (!name || typeof name !== "string") continue;

    if ("type" in server && (server.type === "http" || server.type === "sse")) {
      // HTTP/SSE — mcp-bridge currently only supports stdio, so warn
      log.warn("HTTP/SSE MCP server not supported by mcp-bridge, skipping", {
        name,
        type: server.type,
      });
    } else {
      // Stdio type (default)
      const stdio = server as AcpStdioMcpServer;
      if (!stdio.command || typeof stdio.command !== "string") {
        log.warn("Stdio MCP server missing command, skipping", { name });
        continue;
      }

      const env: Record<string, string> | undefined = Array.isArray(stdio.env)
        ? Object.fromEntries(
            stdio.env
              .filter((e) => e && typeof e.name === "string")
              .map((e) => [e.name, e.value ?? ""])
          )
        : undefined;

      servers[name] = {
        command: stdio.command,
        args: Array.isArray(stdio.args) ? stdio.args : [],
        ...(env && { env }),
      };
    }
  }

  return { servers };
}

// ─── Forwarding ─────────────────────────────────────────

/**
 * Forward ACP session MCP servers to MCPManager.
 * Call this from handleNewSession patch when params.mcpServers is present.
 *
 * @returns true if MCP servers were forwarded, false if none present
 */
export function forwardAcpMcpServers(
  mcpServers: unknown,
  mcpManager: MCPManager
): boolean {
  if (!Array.isArray(mcpServers) || mcpServers.length === 0) {
    return false;
  }

  const log = logger.child("mcp-acp-adapter");
  const mcpConfig = convertAcpMcpServers(mcpServers as AcpMcpServer[]);

  if (Object.keys(mcpConfig.servers).length === 0) {
    return false;
  }

  mcpManager.setSessionConfig(mcpConfig);
  log.info("Loaded MCP servers from ACP session", {
    servers: Object.keys(mcpConfig.servers),
  });

  return true;
}
