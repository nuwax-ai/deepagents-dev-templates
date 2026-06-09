/**
 * MCP Manager
 *
 * Handles MCP server discovery and configuration merging.
 * Merge strategy: session overrides > platform MCPs > default MCPs
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { logger } from "../logger.js";

// ─── Types ──────────────────────────────────────────────

export interface MCPServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  description?: string;
  env?: Record<string, string>;
  auth?: {
    type: "env" | "header";
    var?: string;
    header?: string;
  };
}

export interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

export type MergeStrategy = "session-wins" | "platform-wins" | "defaults-wins";

// ─── MCP Manager ────────────────────────────────────────

export class MCPManager {
  private log = logger.child("mcp");
  private defaultConfig: MCPConfig = { servers: {} };
  private platformConfig: MCPConfig = { servers: {} };
  private sessionConfig: MCPConfig = { servers: {} };
  private mergeStrategy: MergeStrategy;
  private baseDir: string;
  private mergedConfigCache: MCPConfig | null = null;

  constructor(options?: {
    defaultConfig?: MCPConfig;
    defaultConfigPath?: string;
    defaultConfigPaths?: string[];
    mergeStrategy?: MergeStrategy;
    baseDir?: string;
  }) {
    this.mergeStrategy = options?.mergeStrategy ?? "session-wins";
    this.baseDir = options?.baseDir ?? process.cwd();
    if (options?.defaultConfig) {
      this.defaultConfig = {
        servers: {
          ...this.defaultConfig.servers,
          ...options.defaultConfig.servers,
        },
      };
    }
    for (const configPath of options?.defaultConfigPaths ?? []) {
      this.loadDefaultConfig(configPath);
    }
    if (options?.defaultConfigPath) {
      this.loadDefaultConfig(options.defaultConfigPath);
    }
  }

  /** Load default MCP config from file */
  private loadDefaultConfig(configPath: string): void {
    const resolved = resolve(this.baseDir, configPath);
    if (!existsSync(resolved)) {
      this.log.warn(`Default MCP config not found: ${resolved}`);
      return;
    }

    try {
      const content = readFileSync(resolved, "utf-8");
      const parsed = JSON.parse(content) as MCPConfig;
      this.defaultConfig = {
        servers: {
          ...this.defaultConfig.servers,
          ...parsed.servers,
        },
      };
      this.log.info("Loaded default MCP config", {
        servers: Object.keys(parsed.servers),
      });
    } catch (err) {
      this.log.error("Failed to parse default MCP config", {
        error: String(err),
      });
    }
  }

  /**
   * Set platform-delivered MCP configuration.
   *
   * @scaffold — Not yet wired. This method exists for future platform integration
   * where the Nuwax platform delivers MCP server configs at runtime.
   * Currently never invoked — platformConfig tier is always empty.
   * Call this from createRuntimeContext() when platform MCP fetching is implemented.
   */
  setPlatformConfig(config: MCPConfig): void {
    this.platformConfig = config;
    this.mergedConfigCache = null; // Invalidate cache
    this.log.info("Set platform MCP config", {
      servers: Object.keys(config.servers),
    });
  }

  /** Set session-level MCP overrides (from ACP client) */
  setSessionConfig(config: MCPConfig): void {
    this.sessionConfig = config;
    this.mergedConfigCache = null; // Invalidate cache
    this.log.info("Set session MCP config", {
      servers: Object.keys(config.servers),
    });
  }

  /**
   * Get merged MCP configuration based on the merge strategy.
   * Results are cached and invalidated when config layers change.
   *
   * session-wins (default): session > platform > defaults
   * platform-wins: platform > session > defaults
   * defaults-wins: defaults > platform > session
   */
  getMergedConfig(): MCPConfig {
    if (this.mergedConfigCache) {
      return this.mergedConfigCache;
    }

    const layers = this.getLayerOrder();
    const merged: Record<string, MCPServerConfig> = {};

    // Apply layers in order (later layers win on conflict)
    for (const layer of layers) {
      for (const [name, config] of Object.entries(layer.servers)) {
        if (merged[name]) {
          this.log.debug(`MCP server "${name}" overridden by higher-priority layer`);
        }
        merged[name] = config;
      }
    }

    const result = { servers: merged };
    this.mergedConfigCache = result;
    this.log.debug("Merged MCP config", {
      totalServers: Object.keys(merged).length,
      serverNames: Object.keys(merged),
    });
    return result;
  }

  /** Get layers in priority order (lowest first, highest last = wins) */
  private getLayerOrder(): MCPConfig[] {
    switch (this.mergeStrategy) {
      case "session-wins":
        return [this.defaultConfig, this.platformConfig, this.sessionConfig];
      case "platform-wins":
        return [this.defaultConfig, this.sessionConfig, this.platformConfig];
      case "defaults-wins":
        return [this.sessionConfig, this.platformConfig, this.defaultConfig];
      default:
        return [this.defaultConfig, this.platformConfig, this.sessionConfig];
    }
  }

  /** Get a specific MCP server config by name */
  getServer(name: string): MCPServerConfig | undefined {
    return this.getMergedConfig().servers[name];
  }

  /** List all available MCP server names */
  listServers(): string[] {
    return Object.keys(this.getMergedConfig().servers);
  }

  /** Validate that required MCP servers are configured */
  validate(requiredServers: string[]): { valid: boolean; missing: string[] } {
    const available = this.listServers();
    const missing = requiredServers.filter((s) => !available.includes(s));
    return {
      valid: missing.length === 0,
      missing,
    };
  }
}
