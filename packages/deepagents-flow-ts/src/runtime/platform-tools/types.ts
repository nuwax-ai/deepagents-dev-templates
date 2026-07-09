export interface PlatformToolRef {
  targetType: "Plugin" | "Workflow" | "Knowledge";
  targetId: number;
  name?: string;
  /** 平台返回的工具名（若有，优先于自动拼 targetType_targetId）；get-config 不一定返回 */
  toolName?: string;
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
  contentType?: string;
}
