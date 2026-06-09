export interface AppConfig {
  agent: {
    name: string;
    description: string;
    version: string;
    outputStyle: string;
    systemPrompt?: string;
    systemPromptPath: string;
    includeWorkspaceInstructions: boolean;
  };
  model: {
    provider: "anthropic" | "openai";
    name: string;
    baseUrl?: string;
    settings: {
      temperature: number;
      maxTokens?: number;
    };
  };
  permissions: {
    mode: "yolo" | "ask" | "plan";
    interruptOn: string[];
    allowedPaths: string[];
    deniedPaths: string[];
  };
  skills: {
    directories: string[];
    progressiveLoading: boolean;
  };
  agentsDirectories: string[];
  memory: {
    enabled: boolean;
    dir: string;
    addCacheControl: boolean;
  };
  hooks: unknown[];
  middleware: {
    stuckLoopDetection: {
      enabled: boolean;
      threshold: number;
      mode: "warn" | "error";
    };
    periodicReminder: {
      enabled: boolean;
      firstAt: number;
      every: number;
    };
    costTracking: {
      enabled: boolean;
      warnAtTokens: number;
    };
  };
  compaction: Record<string, unknown> & { enabled: boolean };
  eviction: Record<string, unknown> & { enabled: boolean };
}

export interface ACPSessionConfig {
  model?: string;
  systemPrompt?: string;
  cwd?: string;
  agentId?: string;
  spaceId?: string;
  mcpServers?: Record<string, unknown>;
}

export interface ToolLike {
  name: string;
  description?: string;
  schema?: unknown;
}

export interface RuntimeContext {
  config: AppConfig;
  tools: ToolLike[];
  platformClient: unknown;
  mcpManager: unknown;
  variableManager: unknown;
  toolContext: unknown;
}

export interface CreatedAgent {
  agent: unknown;
  context: RuntimeContext;
  backend: unknown;
}

export interface DiscoveredSubAgent {
  name: string;
  description: string;
  systemPrompt: string;
}

export interface TemplateRuntime {
  /**
   * Template's exported Zod schema for the app config. Used by the editing
   * engine to validate patched source config before writing. The template
   * `./runtime` barrel re-exports it (config/config-schema.ts).
   */
  AppConfigSchema: {
    parse(data: unknown): AppConfig;
    safeParse(data: unknown):
      | { success: true; data: AppConfig }
      | { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } };
  };
  loadConfig(options?: {
    configPath?: string;
    workspaceRoot?: string;
    sessionConfig?: ACPSessionConfig;
  }): AppConfig;
  resolveConfiguredWorkspaceRoot(config: AppConfig, fallback?: string): string;
  createRuntimeContext(config: AppConfig, sessionConfig?: ACPSessionConfig): RuntimeContext;
  createAppAgentAsync(config: AppConfig, sessionConfig?: ACPSessionConfig): Promise<CreatedAgent>;
  resolveModelString(config: AppConfig): string;
  resolveSystemPrompt(config: AppConfig, sessionConfig: ACPSessionConfig | undefined, workspaceRoot: string): string;
  discoverMemoryFiles(workspaceRoot: string, includeWorkspaceInstructions?: boolean): string[];
  resolveSkillsPaths(config: AppConfig): string[];
  discoverSubAgents(config: AppConfig, workspaceRoot?: string): DiscoveredSubAgent[];
  buildPermissions(config: AppConfig): Array<{
    operations: string[];
    paths: string[];
    mode?: "allow" | "deny";
  }>;
  buildInterruptOn(tools: string[]): Record<string, boolean>;
}

let cachedRuntime: TemplateRuntime | null = null;

export async function loadTemplateRuntime(): Promise<TemplateRuntime> {
  if (cachedRuntime) {
    return cachedRuntime;
  }

  if (process.env.INSPECTOR_TEMPLATE_SOURCE === "1") {
    const sourceSpecifier = "../../template/src/runtime/index.js";
    cachedRuntime = (await import(sourceSpecifier)) as unknown as TemplateRuntime;
  } else {
    const packageSpecifier = "deepagents-dev-templates/runtime";
    cachedRuntime = (await import(packageSpecifier)) as unknown as TemplateRuntime;
  }

  return cachedRuntime;
}
