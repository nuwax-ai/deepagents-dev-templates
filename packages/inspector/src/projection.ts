import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { AppConfig, ACPSessionConfig, RuntimeContext, TemplateRuntime, ToolLike } from "./template-runtime.js";
import type {
  AgentMeta,
  MemorySpec,
  MiddlewareSpec,
  PermissionsSpec,
  SkillSpec,
  SkillsSpec,
  SubagentSpec,
  SystemPromptSpec,
  ToolSpec,
} from "./types.js";

const PROMPT_LIMIT = 50 * 1024;
const SUBAGENT_PROMPT_LIMIT = 4 * 1024;
const TOOL_SCHEMA_LIMIT = 2 * 1024;

export interface ProjectionInput {
  config: AppConfig;
  sessionConfig?: ACPSessionConfig;
  workspaceRoot: string;
  runtimeContext: RuntimeContext;
  runtime: TemplateRuntime;
  warnings: string[];
}

export function projectMeta(input: ProjectionInput): AgentMeta {
  const { config, workspaceRoot, runtime } = input;
  return {
    agentName: config.agent.name,
    agentDescription: config.agent.description,
    agentVersion: config.agent.version,
    permissionsMode: config.permissions.mode,
    workspaceRoot,
    model: {
      provider: config.model.provider,
      name: config.model.name,
      baseUrl: config.model.baseUrl,
      temperature: config.model.settings.temperature,
      maxTokens: config.model.settings.maxTokens,
      modelString: runtime.resolveModelString(config),
    },
  };
}

export function projectSystemPrompt(input: ProjectionInput): SystemPromptSpec {
  const { config, sessionConfig, workspaceRoot, runtime, warnings } = input;
  const resolved = runtime.resolveSystemPrompt(config, sessionConfig, workspaceRoot);
  const promptPath = resolvePromptPath(config.agent.systemPromptPath, workspaceRoot);
  const source = inferPromptSource(config, sessionConfig, promptPath);
  if (source === "fallback" && config.agent.systemPromptPath && !existsSync(promptPath)) {
    warnings.push(`System prompt file not found: ${promptPath}; using fallback prompt`);
  }
  const truncated = truncate(resolved, PROMPT_LIMIT);
  return {
    source,
    resolved: truncated.value,
    path: source === "file" ? promptPath : undefined,
    styleName: config.agent.outputStyle,
    charCount: resolved.length,
    truncated: truncated.truncated,
  };
}

export function projectTools(input: ProjectionInput): ToolSpec[] {
  const warnings = input.warnings;
  const customTools = input.runtimeContext.tools.map((tool) => projectTool(tool, warnings));
  return [...customTools, ...deepAgentsBuiltinTools()];
}

export function projectSubagents(input: ProjectionInput): SubagentSpec[] {
  const discovered = input.runtime.discoverSubAgents(input.config, input.workspaceRoot);
  const sourceByName = discoverSubagentSources(input.config, input.workspaceRoot);
  return discovered.map((subagent) => {
    const truncated = truncate(subagent.systemPrompt, SUBAGENT_PROMPT_LIMIT);
    return {
      name: subagent.name,
      description: subagent.description,
      source: sourceByName.get(subagent.name) ?? sourceByName.get(basename(subagent.name)) ?? "unknown",
      systemPrompt: truncated.value,
      charCount: subagent.systemPrompt.length,
      truncated: truncated.truncated,
    };
  });
}

export function projectSkills(input: ProjectionInput): SkillsSpec {
  const directories = input.runtime.resolveSkillsPaths(input.config);
  const files: SkillSpec[] = [];
  for (const directory of directories) {
    const absoluteDir = resolveResourcePath(directory, input.workspaceRoot);
    if (!existsSync(absoluteDir)) {
      continue;
    }
    let entries: string[];
    try {
      entries = readdirSync(absoluteDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      input.warnings.push(`Failed to read skills directory ${absoluteDir}: ${errorMessage(error)}`);
      continue;
    }
    for (const entry of entries) {
      const skillPath = join(absoluteDir, entry, "SKILL.md");
      if (!existsSync(skillPath)) {
        continue;
      }
      try {
        files.push(parseSkillFile(skillPath, input.workspaceRoot));
      } catch (error) {
        input.warnings.push(`Failed to parse skill ${skillPath}: ${errorMessage(error)}`);
      }
    }
  }
  return { directories, files };
}

export function projectMemory(input: ProjectionInput): MemorySpec {
  const files = input.runtime.discoverMemoryFiles(
    input.workspaceRoot,
    input.config.agent.includeWorkspaceInstructions
  );
  return {
    enabled: input.config.memory.enabled && files.length > 0,
    files,
    absolutePaths: files.map((file) => resolve(input.workspaceRoot, file)),
    addCacheControl: input.config.memory.addCacheControl && input.config.model.provider === "anthropic",
  };
}

export function projectMiddleware(input: ProjectionInput, memory: MemorySpec): MiddlewareSpec[] {
  const { config } = input;
  const definitions: Array<Omit<MiddlewareSpec, "order">> = [
    {
      name: "memory",
      factory: "createMemoryMiddleware",
      enabled: memory.enabled,
      config: {
        files: memory.files,
        addCacheControl: memory.addCacheControl,
      },
      source: "deepagents-builtin",
    },
    {
      name: "stuck-loop",
      factory: "createStuckLoopMiddleware",
      enabled: config.middleware.stuckLoopDetection.enabled,
      config: config.middleware.stuckLoopDetection,
      source: "custom",
    },
    {
      name: "fs-path-resolver",
      factory: "createFsPathResolver",
      enabled: true,
      config: { workspaceRoot: input.workspaceRoot },
      source: "custom",
    },
    {
      name: "periodic-reminder",
      factory: "createPeriodicReminderMiddleware",
      enabled: config.middleware.periodicReminder.enabled,
      config: config.middleware.periodicReminder,
      source: "custom",
    },
    {
      name: "cost-tracking",
      factory: "createCostTrackingMiddleware",
      enabled: config.middleware.costTracking.enabled,
      config: config.middleware.costTracking,
      source: "custom",
    },
    {
      name: "compaction",
      factory: "createCompactionMiddleware",
      enabled: config.compaction.enabled,
      config: config.compaction,
      source: "custom",
    },
    {
      name: "eviction",
      factory: "createEvictionMiddleware",
      enabled: config.eviction.enabled,
      config: config.eviction,
      source: "custom",
    },
    {
      name: "hooks",
      factory: "createHookMiddleware",
      enabled: config.hooks.length > 0,
      config: { count: config.hooks.length },
      source: "custom",
    },
  ];

  return definitions.map((definition, order) => ({ ...definition, order }));
}

export function projectPermissions(input: ProjectionInput): PermissionsSpec {
  const { config, runtime } = input;
  const effectiveRules =
    config.permissions.mode === "yolo"
      ? [{ operations: ["read", "write"] as Array<"read" | "write">, paths: ["/**"], mode: "allow" as const }]
      : runtime.buildPermissions(config).map((rule) => ({
          operations: rule.operations as Array<"read" | "write">,
          paths: rule.paths,
          mode: rule.mode ?? "allow",
        }));

  return {
    mode: config.permissions.mode,
    deniedPaths: config.permissions.deniedPaths,
    allowedPaths: config.permissions.allowedPaths,
    interruptOn: config.permissions.mode === "yolo" ? [] : Object.keys(runtime.buildInterruptOn(config.permissions.interruptOn)),
    effectiveRules,
  };
}

function projectTool(tool: ToolLike, warnings: string[]): ToolSpec {
  const schemaPreview = previewToolSchema(tool, warnings);
  return {
    name: tool.name,
    description: tool.description ?? "",
    kind: inferToolKind(tool.name),
    source: inferToolSource(tool.name),
    schemaPreview,
  };
}

function deepAgentsBuiltinTools(): ToolSpec[] {
  return [
    { name: "read_file", description: "Read files from the agent backend.", kind: "deepagents-builtin", source: "deepagents" },
    { name: "write_file", description: "Write files to the agent backend.", kind: "deepagents-builtin", source: "deepagents" },
    { name: "edit_file", description: "Edit files in the agent backend.", kind: "deepagents-builtin", source: "deepagents" },
    { name: "execute", description: "Execute commands through the configured backend.", kind: "deepagents-builtin", source: "deepagents" },
    { name: "task", description: "Delegate work to a subagent.", kind: "deepagents-builtin", source: "deepagents" },
    { name: "write_todos", description: "Maintain the agent todo list.", kind: "deepagents-builtin", source: "deepagents" },
  ];
}

function inferToolKind(name: string): ToolSpec["kind"] {
  if (name === "mcp_tool_bridge") {
    return "mcp-bridge";
  }
  if (name === "platform_api" || name === "agent_variable") {
    return "context-bound";
  }
  return "stateless";
}

function inferToolSource(name: string): string {
  if (name === "mcp_tool_bridge") {
    return "template:mcp";
  }
  if (name === "platform_api" || name === "agent_variable") {
    return "template:platform";
  }
  return "template:app";
}

function previewToolSchema(tool: ToolLike, warnings: string[]): string | undefined {
  const schema = tool.schema;
  if (!schema) {
    return undefined;
  }
  try {
    return truncate(safeStringify(schema), TOOL_SCHEMA_LIMIT).value;
  } catch (error) {
    warnings.push(`Failed to serialize schema for tool ${tool.name}: ${errorMessage(error)}`);
    return undefined;
  }
}

function parseSkillFile(path: string, workspaceRoot: string): SkillSpec {
  const content = readFileSync(path, "utf-8");
  const frontmatter = parseFrontmatter(content);
  const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return {
    name: h1 || basename(dirname(path)),
    source: classifySkillSource(path, workspaceRoot),
    path,
    description: frontmatter.description,
  };
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) {
      values[key] = value;
    }
  }
  return values;
}

function classifySkillSource(path: string, workspaceRoot: string): SkillSpec["source"] {
  if (path.includes("/skills/builtin/")) {
    return "builtin";
  }
  if (path.includes("/skills/platform/")) {
    return "platform";
  }
  if (path.startsWith(resolve(workspaceRoot, ".agents")) || path.includes("/.agents/skills/")) {
    return "agent";
  }
  return "unknown";
}

function discoverSubagentSources(config: AppConfig, workspaceRoot: string): Map<string, string> {
  const sources = new Map<string, string>();
  for (const agentsDir of config.agentsDirectories) {
    const agentsPath = resolve(resolveResourcePath(agentsDir, workspaceRoot), "agents");
    if (!existsSync(agentsPath)) {
      continue;
    }
    let entries: string[];
    try {
      entries = readdirSync(agentsPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const agentPath = join(agentsPath, entry, "AGENT.md");
      if (!existsSync(agentPath)) {
        continue;
      }
      sources.set(entry, agentPath);
      try {
        const frontmatter = parseFrontmatter(readFileSync(agentPath, "utf-8"));
        if (frontmatter.name) {
          sources.set(frontmatter.name, agentPath);
        }
      } catch {
        // Source lookup is best-effort.
      }
    }
  }
  return sources;
}

function inferPromptSource(
  config: AppConfig,
  sessionConfig: ACPSessionConfig | undefined,
  promptPath: string
): SystemPromptSpec["source"] {
  if (sessionConfig?.systemPrompt) {
    return "session";
  }
  if (config.agent.systemPrompt) {
    return "config";
  }
  if (existsSync(promptPath)) {
    return "file";
  }
  return "fallback";
}

function resolvePromptPath(path: string, workspaceRoot: string): string {
  return resolveResourcePath(path, workspaceRoot);
}

function resolveResourcePath(path: string, workspaceRoot: string): string {
  if (path.startsWith("~/.deepagents")) {
    const deepagentsHome = process.env.DEEPAGENTS_HOME || resolve(homedir(), ".deepagents");
    return resolve(deepagentsHome, path.slice("~/.deepagents".length).replace(/^\//, ""));
  }
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  if (path.startsWith("/")) {
    return path;
  }
  if (path.startsWith("./")) {
    return resolve(workspaceRoot, path);
  }
  return resolve(workspaceRoot, path);
}

function truncate(value: string, limit: number): { value: string; truncated: boolean } {
  if (value.length <= limit) {
    return { value, truncated: false };
  }
  return { value: value.slice(0, limit), truncated: true };
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, current) => {
      if (typeof current === "function") {
        return `[Function ${current.name || "anonymous"}]`;
      }
      if (typeof current === "object" && current !== null) {
        if (seen.has(current)) {
          return "[Circular]";
        }
        seen.add(current);
      }
      return current;
    },
    2
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
