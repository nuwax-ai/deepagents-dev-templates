export type FieldType = "enum" | "number" | "string" | "boolean" | "string[]";

export type WidgetType = "dropdown" | "number" | "text" | "switch" | "taglist" | "textarea";

export interface EditableField {
  id: string;
  section: string;
  configPath: string;
  type: FieldType;
  widget: WidgetType;
  label: string;
  hint?: string;
  enumValues?: string[];
  min?: number;
  max?: number;
}

function f(field: Omit<EditableField, "id">): EditableField {
  return { id: field.configPath, ...field };
}

export const EDITABLE_CONFIG_FIELDS: EditableField[] = [
  // agent (6)
  f({ section: "meta", configPath: "agent.name", type: "string", widget: "text", label: "Name" }),
  f({ section: "meta", configPath: "agent.description", type: "string", widget: "text", label: "Description" }),
  f({ section: "meta", configPath: "agent.version", type: "string", widget: "text", label: "Version" }),
  f({
    section: "meta",
    configPath: "agent.outputStyle",
    type: "string",
    widget: "dropdown",
    label: "Output style",
    enumValues: ["concise", "verbose", "terse", "explanatory"],
  }),
  f({
    section: "meta",
    configPath: "agent.systemPromptPath",
    type: "string",
    widget: "text",
    label: "System prompt path",
    hint: "path",
  }),
  f({
    section: "meta",
    configPath: "agent.includeWorkspaceInstructions",
    type: "boolean",
    widget: "switch",
    label: "Include workspace instructions",
  }),

  // model (7)
  f({
    section: "model",
    configPath: "model.provider",
    type: "enum",
    widget: "dropdown",
    label: "Provider",
    enumValues: ["anthropic", "openai"],
  }),
  f({ section: "model", configPath: "model.name", type: "string", widget: "text", label: "Model name" }),
  f({ section: "model", configPath: "model.baseUrl", type: "string", widget: "text", label: "Base URL", hint: "url" }),
  f({
    section: "model",
    configPath: "model.apiKeyEnv",
    type: "string",
    widget: "text",
    label: "API key env var",
    hint: "env-name",
  }),
  f({
    section: "model",
    configPath: "model.authTokenEnv",
    type: "string",
    widget: "text",
    label: "Auth token env var",
    hint: "env-name",
  }),
  f({
    section: "model",
    configPath: "model.settings.temperature",
    type: "number",
    widget: "number",
    label: "Temperature",
    min: 0,
    max: 2,
  }),
  f({ section: "model", configPath: "model.settings.maxTokens", type: "number", widget: "number", label: "Max tokens", min: 1 }),

  // permissions (4)
  f({
    section: "permissions",
    configPath: "permissions.mode",
    type: "enum",
    widget: "dropdown",
    label: "Mode",
    enumValues: ["yolo", "ask", "plan"],
  }),
  f({ section: "permissions", configPath: "permissions.interruptOn", type: "string[]", widget: "taglist", label: "Interrupt on" }),
  f({ section: "permissions", configPath: "permissions.allowedPaths", type: "string[]", widget: "taglist", label: "Allowed paths" }),
  f({ section: "permissions", configPath: "permissions.deniedPaths", type: "string[]", widget: "taglist", label: "Denied paths" }),

  // middleware (8)
  f({ section: "middleware", configPath: "middleware.stuckLoopDetection.enabled", type: "boolean", widget: "switch", label: "Stuck-loop detection" }),
  f({
    section: "middleware",
    configPath: "middleware.stuckLoopDetection.threshold",
    type: "number",
    widget: "number",
    label: "Stuck-loop threshold",
    min: 2,
    max: 10,
  }),
  f({
    section: "middleware",
    configPath: "middleware.stuckLoopDetection.mode",
    type: "enum",
    widget: "dropdown",
    label: "Stuck-loop mode",
    enumValues: ["warn", "error"],
  }),
  f({ section: "middleware", configPath: "middleware.periodicReminder.enabled", type: "boolean", widget: "switch", label: "Periodic reminder" }),
  f({ section: "middleware", configPath: "middleware.periodicReminder.firstAt", type: "number", widget: "number", label: "Reminder first at", min: 1 }),
  f({ section: "middleware", configPath: "middleware.periodicReminder.every", type: "number", widget: "number", label: "Reminder interval", min: 1 }),
  f({ section: "middleware", configPath: "middleware.costTracking.enabled", type: "boolean", widget: "switch", label: "Cost tracking" }),
  f({ section: "middleware", configPath: "middleware.costTracking.warnAtTokens", type: "number", widget: "number", label: "Cost warn at tokens", min: 1000 }),

  // lifecycle (2)
  f({ section: "lifecycle", configPath: "compaction.enabled", type: "boolean", widget: "switch", label: "Compaction" }),
  f({ section: "lifecycle", configPath: "eviction.enabled", type: "boolean", widget: "switch", label: "Eviction" }),

  // memory (2)
  f({ section: "memory", configPath: "memory.enabled", type: "boolean", widget: "switch", label: "Memory" }),
  f({ section: "memory", configPath: "memory.addCacheControl", type: "boolean", widget: "switch", label: "Cache control" }),

  // skills (1)
  f({ section: "skills", configPath: "skills.directories", type: "string[]", widget: "taglist", label: "Skill directories" }),
];

export function findField(configPath: string): EditableField | undefined {
  return EDITABLE_CONFIG_FIELDS.find((field) => field.configPath === configPath);
}

export function groupBySection(fields: EditableField[]): Map<string, EditableField[]> {
  const groups = new Map<string, EditableField[]>();
  for (const field of fields) {
    const list = groups.get(field.section) ?? [];
    list.push(field);
    groups.set(field.section, list);
  }
  return groups;
}
