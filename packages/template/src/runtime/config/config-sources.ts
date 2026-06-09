/**
 * Config sources.
 *
 * Load and shape overlays from the inputs that feed the loader — JSON config
 * files, plugin manifests, and environment variables. Extracted from
 * config-loader.ts; the orchestration that combines these lives there.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { logger } from "../logger.js";
import type { AppConfig } from "./config-schema.js";
import { resolvePath, resolveConfigResourcePath } from "./config-paths.js";
import { setNestedValue, isRecord } from "./config-merge.js";

/** Load JSON config from file path */
export function loadJsonFile(filePath: string, baseDir = process.cwd()): Record<string, unknown> | null {
  const resolved = resolvePath(filePath, baseDir);
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

export function normalizeConfigResourcePaths(config: Record<string, unknown>, baseDir: string): void {
  const mcp = config.mcp;
  if (isRecord(mcp)) {
    if (typeof mcp.configPath === "string") {
      mcp.configPath = resolveConfigResourcePath(mcp.configPath, baseDir);
    }
    if (Array.isArray(mcp.configPaths)) {
      mcp.configPaths = mcp.configPaths.map((entry: unknown) =>
        typeof entry === "string" ? resolveConfigResourcePath(entry, baseDir) : entry
      );
    }
  }

  const skills = config.skills;
  if (isRecord(skills) && Array.isArray(skills.directories)) {
    skills.directories = skills.directories.map((entry: unknown) =>
      typeof entry === "string" ? resolveConfigResourcePath(entry, baseDir) : entry
    );
  }

  if (Array.isArray(config.agentsDirectories)) {
    config.agentsDirectories = config.agentsDirectories.map((entry: unknown) =>
      typeof entry === "string" ? resolveConfigResourcePath(entry, baseDir) : entry
    );
  }

  const memory = config.memory;
  if (isRecord(memory) && typeof memory.dir === "string") {
    memory.dir = resolveConfigResourcePath(memory.dir, baseDir);
  }

  const agent = config.agent;
  if (isRecord(agent) && typeof agent.systemPromptPath === "string") {
    agent.systemPromptPath = resolveConfigResourcePath(agent.systemPromptPath, baseDir);
  }
}

export function modelsOverlayFromFile(filePath: string): Partial<AppConfig> | null {
  const raw = loadJsonFile(filePath);
  if (!raw) {
    return null;
  }
  if (raw.model && typeof raw.model === "object") {
    return raw as Partial<AppConfig>;
  }
  if (raw.default && typeof raw.default === "object") {
    return { model: raw.default as AppConfig["model"] } as Partial<AppConfig>;
  }
  return { model: raw as AppConfig["model"] } as Partial<AppConfig>;
}

export function mcpOverlayFromFile(filePath: string): Partial<AppConfig> | null {
  if (!existsSync(resolvePath(filePath))) {
    return null;
  }
  return { mcp: { configPaths: [resolvePath(filePath)] } as AppConfig["mcp"] } as Partial<AppConfig>;
}

interface PluginManifest {
  id?: string;
  name?: string;
  enabled?: boolean;
  skillsDirectories?: string[];
  agentsDirectories?: string[];
  hooks?: AppConfig["hooks"];
  mcp?: {
    configPath?: string;
    configPaths?: string[];
    servers?: Record<string, unknown>;
  };
  mcpServers?: Record<string, unknown>;
}

export function loadPluginOverlay(config: AppConfig, workspaceRoot: string): Partial<AppConfig> | null {
  const overlay: Partial<AppConfig> = {};
  const enabled = new Set(config.plugins.enabled);
  const disabled = new Set(config.plugins.disabled);

  for (const pluginDir of config.plugins.directories) {
    const resolvedDir = resolvePath(pluginDir, workspaceRoot);
    for (const manifestPath of discoverPluginManifests(resolvedDir)) {
      const manifest = loadJsonFile(manifestPath) as PluginManifest | null;
      if (!manifest) {
        continue;
      }
      const pluginId = manifest.id || manifest.name || manifestPath;
      if (manifest.enabled === false || disabled.has(pluginId)) {
        continue;
      }
      if (enabled.size > 0 && !enabled.has(pluginId)) {
        continue;
      }

      const baseDir = dirname(manifestPath);
      if (manifest.skillsDirectories?.length) {
        overlay.skills = {
          ...overlay.skills,
          directories: [
            ...(overlay.skills?.directories ?? []),
            ...manifest.skillsDirectories.map((path) => resolvePath(path, baseDir)),
          ],
        } as Partial<AppConfig["skills"]> as AppConfig["skills"];
      }
      if (manifest.agentsDirectories?.length) {
        overlay.agentsDirectories = [
          ...(overlay.agentsDirectories ?? []),
          ...manifest.agentsDirectories.map((path) => resolvePath(path, baseDir)),
        ];
      }
      if (manifest.hooks?.length) {
        overlay.hooks = [...(overlay.hooks ?? []), ...manifest.hooks];
      }

      const configPaths = [
        ...(manifest.mcp?.configPath ? [manifest.mcp.configPath] : []),
        ...(manifest.mcp?.configPaths ?? []),
      ].map((path) => resolvePath(path, baseDir));
      const servers = {
        ...(manifest.mcp?.servers ?? {}),
        ...(manifest.mcpServers ?? {}),
      };
      if (configPaths.length > 0 || Object.keys(servers).length > 0) {
        overlay.mcp = {
          ...overlay.mcp,
          configPaths: [...(overlay.mcp?.configPaths ?? []), ...configPaths],
          servers: { ...(overlay.mcp?.servers ?? {}), ...servers },
        } as AppConfig["mcp"];
      }
    }
  }

  return Object.keys(overlay).length > 0 ? overlay : null;
}

function discoverPluginManifests(pluginRoot: string): string[] {
  if (!existsSync(pluginRoot)) {
    return [];
  }
  const rootManifest = resolve(pluginRoot, "plugin.json");
  if (existsSync(rootManifest)) {
    return [rootManifest];
  }
  return readdirSync(pluginRoot)
    .map((entry) => resolve(pluginRoot, entry))
    .filter((entryPath) => {
      try {
        return statSync(entryPath).isDirectory();
      } catch {
        return false;
      }
    })
    .map((entryPath) => resolve(entryPath, "plugin.json"))
    .filter((manifestPath) => existsSync(manifestPath));
}

// ─── Environment Variable Mapping ───────────────────────

const ENV_MAP: Record<string, string> = {
  ACP_AGENT_NAME: "agent.name",
  ACP_AGENT_DESCRIPTION: "agent.description",
  AGENT_SYSTEM_PROMPT: "agent.systemPrompt",
  AGENT_SYSTEM_PROMPT_PATH: "agent.systemPromptPath",
  DEEPAGENTS_WORKING_DIR: "workspace.workingDir",
  AGENT_WORKING_DIR: "workspace.workingDir",
  PLATFORM_API_BASE_URL: "platform.apiBaseUrl",
  PLATFORM_AGENT_ID: "platform.agentId",
  PLATFORM_SPACE_ID: "platform.spaceId",
  DEFAULT_MODEL: "model.name",
  ANTHROPIC_MODEL: "model.name",
  ANTHROPIC_BASE_URL: "model.baseUrl",
  OPENAI_MODEL: "model.name",
  OPENAI_BASE_URL: "model.baseUrl",
  LLM_PROVIDER: "model.provider",
  MAX_TOKENS: "model.settings.maxTokens",
  MCP_CONFIG_PATH: "mcp.configPath",
  LOG_LEVEL: "logging.level",
  DEEPAGENTS_PERMISSIONS_MODE: "permissions.mode",
  DEEPAGENTS_SANDBOX_PROFILE: "sandbox.profile",
};

/** Numeric env vars that need parsing */
const NUMERIC_ENV_KEYS = new Set(["MAX_TOKENS"]);

/** Build config overlay from environment variables */
export function loadFromEnv(): Partial<AppConfig> {
  const overlay: Record<string, unknown> = {};
  for (const [envKey, configPath] of Object.entries(ENV_MAP)) {
    const value = process.env[envKey];
    if (value !== undefined && value !== "") {
      // Parse numeric env vars
      if (NUMERIC_ENV_KEYS.has(envKey)) {
        const num = Number(value);
        if (!isNaN(num)) {
          setNestedValue(overlay, configPath, num);
        }
      } else {
        setNestedValue(overlay, configPath, value);
      }
    }
  }
  // ACP_DEBUG is a boolean flag that maps to logging.level = "debug"
  const acpDebug = process.env.ACP_DEBUG;
  if (acpDebug === "true" || acpDebug === "1") {
    setNestedValue(overlay, "logging.level", "debug");
  }
  return overlay as Partial<AppConfig>;
}

/**
 * 当未设置 LLM_PROVIDER 时，根据环境变量中的凭证族自动推断 model.provider。
 *
 * Zed / rcoder 的 OpenAI 兼容 profile 通常只注入 OPENAI_*，不应再强制要求
 * LLM_PROVIDER=openai。显式设置 LLM_PROVIDER 时仍以该值为准。
 */
export function inferModelProviderIfUnset(config: AppConfig): AppConfig {
  const explicit = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit === "openai" || explicit === "anthropic") {
    return config;
  }

  const hasOpenAISignals = !!(
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.OPENAI_BASE_URL?.trim()
  );
  const hasAnthropicSignals = !!(
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.ANTHROPIC_AUTH_TOKEN?.trim() ||
    process.env.ANTHROPIC_BASE_URL?.trim()
  );

  let provider: AppConfig["model"]["provider"] | null = null;

  if (hasOpenAISignals && !hasAnthropicSignals) {
    provider = "openai";
  } else if (hasAnthropicSignals && !hasOpenAISignals) {
    provider = "anthropic";
  } else if (hasOpenAISignals && hasAnthropicSignals && process.env.OPENAI_API_KEY?.trim()) {
    // 两套凭证同时存在且未指定 LLM_PROVIDER：有 OPENAI_API_KEY 时走 OpenAI 兼容路径
    provider = "openai";
  }

  if (!provider || provider === config.model.provider) {
    return config;
  }

  return {
    ...config,
    model: {
      ...config.model,
      provider,
      // OpenAI 路径默认从 OPENAI_API_KEY 取密钥
      ...(provider === "openai" ? { apiKeyEnv: "OPENAI_API_KEY" } : {}),
    },
  };
}
