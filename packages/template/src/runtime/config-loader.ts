/**
 * Configuration Loader
 *
 * Implements the config priority chain:
 *   ACP/session meta > Environment variables > config/app-agent.config.json > Defaults
 *
 * Pattern borrowed from pydantic-deepagents CLI configuration system.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { logger } from "./logger.js";

// ─── Config Schema ──────────────────────────────────────

export const ModelConfigSchema = z.object({
  provider: z.string().default("anthropic"),
  name: z.string().default("claude-sonnet-4-6"),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().default("ANTHROPIC_API_KEY"),
  authTokenEnv: z.string().default("ANTHROPIC_AUTH_TOKEN"),
  settings: z
    .object({
      temperature: z.number().min(0).max(2).default(0),
      maxTokens: z.number().optional(),
    })
    .default({}),
});

export const MCPConfigSchema = z.object({
  configPath: z.string().default("./config/mcp.default.json"),
  mergeStrategy: z.enum(["session-wins", "platform-wins", "defaults-wins"]).default("session-wins"),
});

export const PlatformConfigSchema = z.object({
  apiBaseUrl: z.string().url().default("https://api.nuwax.com"),
  agentId: z.string().default(""),
  spaceId: z.string().default(""),
  endpoints: z.object({
    savePrompt: z.object({ method: z.string().default("POST"), path: z.string().default("/api/agent/config/update") }).default({}),
    queryPlugins: z.object({ method: z.string().default("GET"), path: z.string().default("/api/agent/component/search") }).default({}),
    bindComponent: z.object({ method: z.string().default("POST"), path: z.string().default("/api/agent/component/add") }).default({}),
    listComponents: z.object({ method: z.string().default("GET"), path: z.string().default("/api/agent/component/list/{agentId}") }).default({}),
    createVariable: z.object({ method: z.string().default("POST"), path: z.string().default("/api/agent/variable/add") }).default({}),
    updateVariable: z.object({ method: z.string().default("POST"), path: z.string().default("/api/agent/variable/update") }).default({}),
    listVariables: z.object({ method: z.string().default("GET"), path: z.string().default("/api/agent/variable/list/{agentId}") }).default({}),
    executePlugin: z.object({ method: z.string().default("POST"), path: z.string().default("/api/v1/plugin/{pluginId}/execute") }).default({}),
    executeWorkflow: z.object({ method: z.string().default("POST"), path: z.string().default("/api/v1/workflow/{workflowId}/execute") }).default({}),
    createDebugSession: z.object({ method: z.string().default("POST"), path: z.string().default("/api/agent/debug/session") }).default({}),
    getDebugSession: z.object({ method: z.string().default("GET"), path: z.string().default("/api/agent/debug/session/{sessionId}") }).default({}),
  }).default({}),
});

export const PermissionsConfigSchema = z.object({
  interruptOn: z.array(z.string()).default(["write_file", "edit_file", "execute"]),
  allowedPaths: z.array(z.string()).default(["src/app/", "prompts/", "skills/", "config/"]),
  deniedPaths: z.array(z.string()).default(["src/runtime/"]),
});

export const SkillsConfigSchema = z.object({
  directories: z.array(z.string()).default(["./skills/builtin/", "./skills/platform/"]),
  progressiveLoading: z.boolean().default(true),
});

export const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  dir: z.string().default("./.agent-memory"),
});

export const LoggingConfigSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  structured: z.boolean().default(true),
});

export const AppConfigSchema = z.object({
  agent: z.object({
    name: z.string().default("deepagents-app-agent"),
    description: z.string().default("AI application agent"),
    version: z.string().default("0.1.0"),
  }).default({}),
  model: ModelConfigSchema.default({}),
  mcp: MCPConfigSchema.default({}),
  platform: PlatformConfigSchema.default({}),
  permissions: PermissionsConfigSchema.default({}),
  skills: SkillsConfigSchema.default({}),
  memory: MemoryConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;
export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;

// ─── Defaults ───────────────────────────────────────────

const DEFAULTS: AppConfig = AppConfigSchema.parse({});

// ─── Environment Variable Mapping ───────────────────────

const ENV_MAP: Record<string, string> = {
  ACP_AGENT_NAME: "agent.name",
  ACP_AGENT_DESCRIPTION: "agent.description",
  PLATFORM_API_BASE_URL: "platform.apiBaseUrl",
  PLATFORM_AGENT_ID: "platform.agentId",
  PLATFORM_SPACE_ID: "platform.spaceId",
  DEFAULT_MODEL: "model.name",
  ANTHROPIC_MODEL: "model.name",
  ANTHROPIC_BASE_URL: "model.baseUrl",
  MCP_CONFIG_PATH: "mcp.configPath",
  LOG_LEVEL: "logging.level",
};

// ─── Helper Functions ───────────────────────────────────

/** Set a nested value in an object using a dot-separated path */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]!] = value;
}

/** Deep merge two objects (source wins). Exported for reuse by app tools. */
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (
      sourceVal &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === "object" &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }
  return result;
}

/** Load JSON config from file path */
function loadJsonFile(filePath: string): Record<string, unknown> | null {
  const resolved = resolve(process.cwd(), filePath);
  if (!existsSync(resolved)) {
    return null;
  }
  try {
    const content = readFileSync(resolved, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch (err) {
    logger.warn(`Failed to parse config file: ${resolved}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Build config overlay from environment variables */
function loadFromEnv(): Partial<AppConfig> {
  const overlay: Record<string, unknown> = {};
  for (const [envKey, configPath] of Object.entries(ENV_MAP)) {
    const value = process.env[envKey];
    if (value !== undefined && value !== "") {
      setNestedValue(overlay, configPath, value);
    }
  }
  // ACP_DEBUG is a boolean flag that maps to logging.level = "debug"
  const acpDebug = process.env.ACP_DEBUG;
  if (acpDebug === "true" || acpDebug === "1") {
    setNestedValue(overlay, "logging.level", "debug");
  }
  return overlay as Partial<AppConfig>;
}

// ─── ACP Session Config ────────────────────────────────

export interface ACPSessionConfig {
  model?: string;
  systemPrompt?: string;
  cwd?: string;
  agentId?: string;
  spaceId?: string;
  mcpServers?: Record<string, unknown>;
}

// ─── Main Loader ────────────────────────────────────────

export interface LoadConfigOptions {
  /** Path to config file (default: ./config/app-agent.config.json) */
  configPath?: string;
  /** ACP session-level overrides (highest priority) */
  sessionConfig?: ACPSessionConfig;
}

/**
 * Load configuration with priority chain:
 *   ACP/session meta > env vars > config file > defaults
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const configPath = options.configPath ?? "./config/app-agent.config.json";

  // Layer 4: Defaults
  let config: AppConfig = { ...DEFAULTS };

  // Layer 3: Config file
  const fileConfig = loadJsonFile(configPath);
  if (fileConfig) {
    config = deepMerge(config, fileConfig as Partial<AppConfig>);
  }

  // Layer 2: Environment variables
  const envConfig = loadFromEnv();
  config = deepMerge(config, envConfig);

  // Layer 1: ACP session overrides (highest priority)
  if (options.sessionConfig) {
    const sessionOverlay: Record<string, unknown> = {};
    const sc = options.sessionConfig;
    if (sc.model) setNestedValue(sessionOverlay, "model.name", sc.model);
    if (sc.agentId) setNestedValue(sessionOverlay, "platform.agentId", sc.agentId);
    if (sc.spaceId) setNestedValue(sessionOverlay, "platform.spaceId", sc.spaceId);
    config = deepMerge(config, sessionOverlay as Partial<AppConfig>);
  }

  // Validate final config
  return AppConfigSchema.parse(config);
}
