export interface PlatformToolRef {
  targetType: "Plugin" | "Workflow" | "Knowledge";
  targetId: number;
  name?: string;
  description?: string;
  schema?: unknown;
  inputSchema?: unknown;
  mode?: string;
  method?: string;
  url?: string;
  auth?: unknown;
  names?: string[];
  toolNames?: string[];
}

export interface PlatformToolDescriptor {
  toolName: string;
  targetType: PlatformToolRef["targetType"];
  targetId: number;
  displayName?: string;
  description?: string;
  rawSchema?: unknown;
  inputSchema?: unknown;
  method?: string;
  url?: string;
  auth?: unknown;
}
