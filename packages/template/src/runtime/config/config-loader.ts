/**
 * Configuration Loader
 *
 * Implements the config priority chain:
 *   ACP/session meta > Environment variables > template config > project .deepagents > user .deepagents > Defaults
 *
 * Pattern borrowed from pydantic-deepagents CLI configuration system.
 *
 * The declarative schema lives in `config-schema.ts` and the generic merge util
 * in `deep-merge.ts`; both are re-exported here so the original import surface
 * (`./config-loader.js`) is unchanged.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";
import {
  AppConfigSchema,
  BUILTIN_TEMPLATE_CONFIGS,
  DEFAULT_BUILTIN_TEMPLATE_CONFIG,
  type AppConfig,
  type BuiltinTemplateConfigName,
  type ACPSessionConfig,
} from "./config-schema.js";
import { deepMerge } from "./deep-merge.js";

export * from "./config-schema.js";
export { deepMerge } from "./deep-merge.js";

const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PACKAGE_ROOT = resolve(RUNTIME_DIR, "..", "..");

function readBuiltinTemplateConfigNameFromEnv(): BuiltinTemplateConfigName | undefined {
  const name = process.env.DEEPAGENTS_BUILTIN_CONFIG;
  if (!name) {
    return undefined;
  }
  if (name in BUILTIN_TEMPLATE_CONFIGS) {
    return name as BuiltinTemplateConfigName;
  }
  logger.warn("Unknown DEEPAGENTS_BUILTIN_CONFIG; falling back to default", {
    requested: name,
    available: Object.keys(BUILTIN_TEMPLATE_CONFIGS),
  });
  return undefined;
}

function resolveBuiltinTemplateConfig(name: BuiltinTemplateConfigName = DEFAULT_BUILTIN_TEMPLATE_CONFIG): {
  path: string;
  resourceBase: string;
} {
  const config = BUILTIN_TEMPLATE_CONFIGS[name];
  return {
    path: resolve(TEMPLATE_PACKAGE_ROOT, config.path),
    resourceBase: resolve(TEMPLATE_PACKAGE_ROOT, config.resourceBase),
  };
}

// ─── Defaults ───────────────────────────────────────────

const DEFAULTS: AppConfig = AppConfigSchema.parse({});

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

// ─── Helper Functions ───────────────────────────────────

/** Set a nested value in an object using a dot-separated path */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    if (!(key in current) || current[key] === null || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]!] = value;
}

function concatUnique(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

function mergeConfigLayer(config: AppConfig, layer: Partial<AppConfig>): AppConfig {
  const previousSkills = config.skills.directories;
  const previousAgents = config.agentsDirectories;
  const previousMcpPaths = config.mcp.configPaths;
  const previousMcpServers = config.mcp.servers;
  const previousPluginDirs = config.plugins.directories;
  const merged = deepMerge(config, layer);

  if (layer.skills?.directories) {
    merged.skills.directories = concatUnique(previousSkills, layer.skills.directories);
  }
  if (layer.agentsDirectories) {
    merged.agentsDirectories = concatUnique(previousAgents, layer.agentsDirectories);
  }
  if (layer.mcp?.configPaths) {
    merged.mcp.configPaths = concatUnique(previousMcpPaths, layer.mcp.configPaths);
  }
  if (layer.mcp?.servers) {
    merged.mcp.servers = { ...previousMcpServers, ...layer.mcp.servers };
  }
  if (layer.plugins?.directories) {
    merged.plugins.directories = concatUnique(previousPluginDirs, layer.plugins.directories);
  }

  return merged;
}

/** Load JSON config from file path */
function loadJsonFile(filePath: string, baseDir = process.cwd()): Record<string, unknown> | null {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeConfigResourcePaths(config: Record<string, unknown>, baseDir: string): void {
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

function resolveConfigResourcePath(path: string, baseDir: string): string {
  if (path.startsWith("~/") || path.startsWith("~/.deepagents/") || isAbsolute(path)) {
    return path;
  }
  return resolve(baseDir, path);
}

function resolvePath(filePath: string, baseDir = process.cwd()): string {
  if (filePath === "~/.deepagents") {
    return deepAgentsHome();
  }
  if (filePath.startsWith("~/.deepagents/")) {
    return resolve(deepAgentsHome(), filePath.slice("~/.deepagents/".length));
  }
  if (filePath.startsWith("~/")) {
    return resolve(homedir(), filePath.slice(2));
  }
  if (isAbsolute(filePath)) {
    return filePath;
  }
  return resolve(baseDir, filePath);
}

function deepAgentsHome(): string {
  return resolve(process.env.DEEPAGENTS_HOME || join(homedir(), ".deepagents"));
}

function modelsOverlayFromFile(filePath: string): Partial<AppConfig> | null {
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

function mcpOverlayFromFile(filePath: string): Partial<AppConfig> | null {
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

function loadPluginOverlay(config: AppConfig, workspaceRoot: string): Partial<AppConfig> | null {
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

/** Numeric env vars that need parsing */
const NUMERIC_ENV_KEYS = new Set(["MAX_TOKENS"]);

/** Build config overlay from environment variables */
function loadFromEnv(): Partial<AppConfig> {
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
function inferModelProviderIfUnset(config: AppConfig): AppConfig {
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

// ─── Main Loader ────────────────────────────────────────

export interface LoadConfigOptions {
  /** Path to config file (default: template package config/app-agent.config.json) */
  configPath?: string;
  /** Built-in template config preset used when configPath is not provided */
  builtinConfig?: BuiltinTemplateConfigName;
  /** Base directory for relative paths inside the template config file */
  configBaseDir?: string;
  /** Workspace root used for project-level .deepagents config discovery */
  workspaceRoot?: string;
  /** ACP session-level overrides (highest priority) */
  sessionConfig?: ACPSessionConfig;
}

/**
 * Load configuration with priority chain:
 *   defaults < user .deepagents < project .deepagents < template config < env vars < ACP/session meta
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const builtinConfig = resolveBuiltinTemplateConfig(
    options.builtinConfig ?? readBuiltinTemplateConfigNameFromEnv()
  );
  const envConfigPath =
    process.env.DEEPAGENTS_CONFIG_PATH ||
    process.env.APP_AGENT_CONFIG_PATH ||
    undefined;
  const configPath = options.configPath ?? envConfigPath ?? builtinConfig.path;
  const userDir = deepAgentsHome();
  const envWorkspaceRoot =
    process.env.DEEPAGENTS_WORKING_DIR ||
    process.env.AGENT_WORKING_DIR ||
    undefined;

  // Layer 1: Defaults
  let config: AppConfig = { ...DEFAULTS };

  // Layer 2: User-level ~/.deepagents config
  const userConfig = loadJsonFile(join(userDir, "config.json"));
  if (userConfig) {
    config = mergeConfigLayer(config, userConfig as Partial<AppConfig>);
  }
  const userModels = modelsOverlayFromFile(join(userDir, "models.json"));
  if (userModels) {
    config = mergeConfigLayer(config, userModels);
  }
  const userMcp = mcpOverlayFromFile(join(userDir, "mcp.json"));
  if (userMcp) {
    config = mergeConfigLayer(config, userMcp);
  }

  const workspaceRoot = resolveConfiguredWorkspaceRoot(
    config,
    options.workspaceRoot ?? options.sessionConfig?.cwd ?? envWorkspaceRoot ?? process.cwd()
  );
  const resolvedConfigPath = resolvePath(configPath, workspaceRoot);
  const usingBuiltinConfig = resolvedConfigPath === builtinConfig.path;
  const configBaseDir = options.configBaseDir ?? (usingBuiltinConfig ? builtinConfig.resourceBase : workspaceRoot);
  const projectDir = resolve(workspaceRoot, ".deepagents");

  // Layer 3: Project-level <workspace>/.deepagents config
  const projectConfig = loadJsonFile(join(projectDir, "config.json"));
  if (projectConfig) {
    config = mergeConfigLayer(config, projectConfig as Partial<AppConfig>);
  }
  const projectMcp = mcpOverlayFromFile(join(projectDir, "mcp.json"));
  if (projectMcp) {
    config = mergeConfigLayer(config, projectMcp);
  }

  // Layer 4: Existing template config (backward compatible)
  const fileConfig = loadJsonFile(configPath, workspaceRoot);
  if (fileConfig) {
    if (usingBuiltinConfig || options.configBaseDir) {
      normalizeConfigResourcePaths(fileConfig, configBaseDir);
    }
    config = mergeConfigLayer(config, fileConfig as Partial<AppConfig>);
  }

  // Layer 4b: Plugin manifests contributed by user/project plugin directories.
  const pluginOverlay = loadPluginOverlay(config, workspaceRoot);
  if (pluginOverlay) {
    config = mergeConfigLayer(config, pluginOverlay);
  }

  // Layer 5: Environment variables
  const envConfig = loadFromEnv();
  config = mergeConfigLayer(config, envConfig);
  config = inferModelProviderIfUnset(config);

  // Layer 6: ACP session overrides (highest priority)
  if (options.sessionConfig) {
    const sessionOverlay: Record<string, unknown> = {};
    const sc = options.sessionConfig;
    if (sc.model) setNestedValue(sessionOverlay, "model.name", sc.model);
    if (sc.agentId) setNestedValue(sessionOverlay, "platform.agentId", sc.agentId);
    if (sc.spaceId) setNestedValue(sessionOverlay, "platform.spaceId", sc.spaceId);
    config = mergeConfigLayer(config, sessionOverlay as Partial<AppConfig>);
  }

  // Validate final config
  return AppConfigSchema.parse(config);
}

export function resolveConfiguredWorkspaceRoot(config: AppConfig, fallback = process.cwd()): string {
  return resolvePath(config.workspace.workingDir || fallback);
}
