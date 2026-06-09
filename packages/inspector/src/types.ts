export type InspectMode = "dry-run" | "full";

export interface AgentOrchestrationSpec {
  schema: "nuwaclaw.agent-orchestration.v1";
  generatedAt: string;
  framework: "deepagents";
  packageVersion: string;
  mode: InspectMode;
  meta: AgentMeta;
  systemPrompt: SystemPromptSpec;
  tools: ToolSpec[];
  subagents: SubagentSpec[];
  skills: SkillsSpec;
  memory: MemorySpec;
  middleware: MiddlewareSpec[];
  permissions: PermissionsSpec;
  graph: GraphSpec | null;
  warnings: string[];
  editable: EditableSpec | null;
}

export interface AgentMeta {
  agentName: string;
  agentDescription?: string;
  agentVersion: string;
  permissionsMode: "yolo" | "ask" | "plan";
  workspaceRoot: string;
  model: {
    provider: string;
    name: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
    modelString: string;
  };
}

export interface SystemPromptSpec {
  source: "session" | "config" | "file" | "fallback";
  resolved: string;
  path?: string;
  styleName?: string;
  charCount: number;
  truncated: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  kind: "stateless" | "context-bound" | "mcp-bridge" | "deepagents-builtin";
  source: string;
  schemaPreview?: string;
  warning?: string;
}

export interface SubagentSpec {
  name: string;
  description: string;
  source: string;
  systemPrompt: string;
  charCount: number;
  truncated: boolean;
}

export interface SkillsSpec {
  directories: string[];
  files: SkillSpec[];
}

export interface SkillSpec {
  name: string;
  source: "builtin" | "platform" | "agent" | "unknown";
  path: string;
  description?: string;
}

export interface MemorySpec {
  enabled: boolean;
  files: string[];
  absolutePaths: string[];
  addCacheControl: boolean;
}

export interface MiddlewareSpec {
  name: string;
  factory: string;
  order: number;
  enabled: boolean;
  config: Record<string, unknown>;
  source: "deepagents-builtin" | "custom" | "platform";
}

export interface PermissionsSpec {
  mode: "yolo" | "ask" | "plan";
  deniedPaths: string[];
  allowedPaths: string[];
  interruptOn: string[];
  effectiveRules: Array<{
    operations: Array<"read" | "write">;
    paths: string[];
    mode: "allow" | "deny";
  }>;
}

export interface EditableFieldSpec {
  id: string;
  section: string;
  configPath: string;
  type: "enum" | "number" | "string" | "boolean" | "string[]";
  label: string;
  enumValues?: string[];
  min?: number;
  max?: number;
  sourceValue: unknown;
  effectiveValue: unknown;
  overridden: boolean;
}

export interface EditableSpec {
  configPath: string;
  fields: EditableFieldSpec[];
}

export interface GraphSpec {
  nodes: Array<{ id: string; name: string; type: string; metadata?: Record<string, unknown> }>;
  edges: Array<{ source: string; target: string; data?: string; conditional: boolean }>;
  conditionalBranches: Array<{
    source: string;
    paths: Array<{ target: string; condition: string }>;
  }>;
  mermaid: string;
  stats: {
    nodeCount: number;
    edgeCount: number;
    conditionalEdgeCount: number;
    hasSubgraphs: boolean;
  };
}
