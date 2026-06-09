/**
 * Config Schema
 *
 * Declarative layer for the agent configuration: Zod schemas, their inferred
 * types, the built-in template config presets, and the ACP session config
 * shape. The loading/merging logic lives in `config-loader.ts`; this module is
 * pure declaration (depends only on zod).
 */

import { z } from "zod";

export const BUILTIN_TEMPLATE_CONFIGS = {
  appAgent: {
    path: "config/app-agent.config.json",
    resourceBase: ".",
  },
} as const;

export type BuiltinTemplateConfigName = keyof typeof BUILTIN_TEMPLATE_CONFIGS;

export const DEFAULT_BUILTIN_TEMPLATE_CONFIG: BuiltinTemplateConfigName = "appAgent";

// ─── Config Schema ──────────────────────────────────────

export const ModelConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai"]).default("anthropic"),
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
  configPaths: z.array(z.string()).default([]),
  servers: z.record(z.unknown()).default({}),
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
  /**
   * Permission mode controlling HITL (human-in-the-loop) behavior:
   * - "yolo": No approvals needed. Agent writes/edits/executes freely.
   * - "ask":  HITL on write/edit/execute. User must approve each operation.
   * - "plan": Agent presents a plan first, user approves, then executes with HITL.
   */
  mode: z.enum(["yolo", "ask", "plan"]).default("ask"),
  interruptOn: z.array(z.string()).default(["write_file", "edit_file", "execute"]),
  allowedPaths: z.array(z.string()).default(["src/app/", "prompts/", "skills/", "config/"]),
  deniedPaths: z.array(z.string()).default(["src/runtime/", "src/surfaces/"]),
});

export const SandboxConfigSchema = z.object({
  /**
   * Sandbox profile:
   * - "custom": preserve `permissions.deniedPaths` behavior.
   * - "workspace-write": allow normal workspace edits while protecting runtime paths.
   * - "read-only": deny all writes.
   * - "open": no sandbox deny rules; useful for trusted local debugging only.
   */
  profile: z.enum(["custom", "workspace-write", "read-only", "open"]).default("custom"),
  writablePaths: z.array(z.string()).default(["src/app/", "prompts/", "skills/", "config/"]),
  deniedWritePaths: z.array(z.string()).default(["src/runtime/", "src/surfaces/"]),
  environment: z.object({
    allowedEnv: z.array(z.string()).default([
      "LLM_PROVIDER",
      "OPENAI_MODEL",
      "OPENAI_BASE_URL",
      "ANTHROPIC_MODEL",
      "ANTHROPIC_BASE_URL",
      "MAX_TOKENS",
      "LOG_LEVEL",
      "LOG_DIR",
    ]),
    secretEnv: z.array(z.string()).default([
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "PLATFORM_API_TOKEN",
    ]),
  }).default({}),
});

export const SkillsConfigSchema = z.object({
  directories: z.array(z.string()).default([
    "~/.deepagents/skills",
    "./.deepagents/skills",
    "./skills/builtin/",
    "./skills/platform/",
  ]),
  progressiveLoading: z.boolean().default(true),
});

export const WorkspaceConfigSchema = z.object({
  workingDir: z.string().optional(),
});

export const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  dir: z.string().default("~/.deepagents/workspaces"),
  addCacheControl: z.boolean().default(true),
});

export const HookConfigSchema = z.object({
  event: z.enum([
    "pre_tool_use",
    "post_tool_use",
    "post_tool_use_failure",
    "before_model_request",
    "after_model_request",
    "before_run",
    "after_run",
  ]),
  matcher: z.string().optional(),
  command: z.string(),
  timeoutMs: z.number().min(1).default(30_000),
  priority: z.number().default(0),
  scope: z.enum(["user", "project"]).optional(),
});

export const PluginsConfigSchema = z.object({
  directories: z.array(z.string()).default(["~/.deepagents/plugins", "./.deepagents/plugins"]),
  enabled: z.array(z.string()).default([]),
  disabled: z.array(z.string()).default([]),
});

export const LoggingConfigSchema = z.object({
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  structured: z.boolean().default(true),
});

export const CompactionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Context window size in tokens. Default: 200000 (Claude 3.5 Sonnet) */
  contextWindow: z.number().min(1000).default(200_000),
  /** Trigger compaction when context exceeds this ratio of contextWindow. Default: 0.8 */
  triggerThreshold: z.number().min(0.1).max(0.95).default(0.8),
  /** Tokens reserved for summary generation. Default: 16384 */
  reserveTokens: z.number().min(1000).default(16_384),
  /** Approximate recent context tokens to keep uncompressed. Default: 20000 */
  keepRecentTokens: z.number().min(1000).default(20_000),
  /**
   * Model name to use for LLM-based summarization. Same provider / credentials /
   * baseUrl as the agent's model. Defaults to the agent's model name when unset,
   * which is fine for small workloads but expensive for long sessions — set
   * to a cheaper model (e.g. "claude-haiku-4-5" or "gpt-4o-mini") for production.
   */
  summarizerModel: z.string().optional(),
});

export const EvictionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /** Token threshold before evicting tool output. Default: 20000 */
  tokenLimit: z.number().min(1000).default(20_000),
  /** Characters per token for estimation. Default: 4 */
  charPerToken: z.number().min(1).default(4),
  /** Lines to show from start in preview. Default: 5 */
  headLines: z.number().min(1).default(5),
  /** Lines to show from end in preview. Default: 5 */
  tailLines: z.number().min(1).default(5),
  /** Backend path for evicted files. Default: "/large_tool_results" */
  evictionPath: z.string().default("/large_tool_results"),
});

export const AppConfigSchema = z.object({
  agent: z.object({
    name: z.string().default("deepagents-app-ts"),
    description: z.string().default("AI application agent"),
    version: z.string().default("0.1.1"),
    outputStyle: z.string().default("concise"),
    systemPrompt: z.string().optional(),
    systemPromptPath: z.string().default("prompts/developer-agent.system.md"),
    includeWorkspaceInstructions: z.boolean().default(true),
  }).default({}),
  model: ModelConfigSchema.default({}),
  mcp: MCPConfigSchema.default({}),
  platform: PlatformConfigSchema.default({}),
  permissions: PermissionsConfigSchema.default({}),
  sandbox: SandboxConfigSchema.default({}),
  skills: SkillsConfigSchema.default({}),
  /**
   * Paths to `.agents` directories that contain skills/ and agents/ subdirectories.
   * Each entry should point to a directory following the `.agents` convention:
   *   <dir>/skills/<skill-name>/SKILL.md
   *   <dir>/agents/<agent-name>/AGENT.md
   *
   * Skills from these directories are merged with the built-in skills.
   * Subagents discovered in agents/ are registered for task delegation.
   *
   * @example ["../examples/thesis-ppt/.agents", "./my-custom-agents"]
   */
  agentsDirectories: z.array(z.string()).default(["~/.deepagents", "./.deepagents", "./.agents"]),
  memory: MemoryConfigSchema.default({}),
  hooks: z.array(HookConfigSchema).default([]),
  plugins: PluginsConfigSchema.default({}),
  workspace: WorkspaceConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  compaction: CompactionConfigSchema.default({}),
  eviction: EvictionConfigSchema.default({}),
  middleware: z.object({
    stuckLoopDetection: z.object({
      enabled: z.boolean().default(true),
      threshold: z.number().min(2).max(10).default(3),
      mode: z.enum(["warn", "error"]).default("warn"),
    }).default({}),
    periodicReminder: z.object({
      enabled: z.boolean().default(true),
      firstAt: z.number().min(1).default(5),
      every: z.number().min(1).default(10),
    }).default({}),
    costTracking: z.object({
      enabled: z.boolean().default(true),
      warnAtTokens: z.number().min(1000).default(100_000),
    }).default({}),
  }).default({}),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type PlatformConfig = z.infer<typeof PlatformConfigSchema>;
export type PermissionsConfig = z.infer<typeof PermissionsConfigSchema>;
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
export type CompactionConfig = z.infer<typeof CompactionConfigSchema>;
export type EvictionConfig = z.infer<typeof EvictionConfigSchema>;

// ─── ACP Session Config ────────────────────────────────

export interface ACPSessionConfig {
  model?: string;
  systemPrompt?: string;
  cwd?: string;
  agentId?: string;
  spaceId?: string;
  mcpServers?: Record<string, unknown>;
}
