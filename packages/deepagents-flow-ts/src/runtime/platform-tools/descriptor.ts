import type { PlatformToolDescriptor, PlatformToolRef } from "./types.js";

function toObject(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * 平台工具的运行时工具名。get-config 返回的工具配置没有工具名，
 * 按 `${targetType}_${targetId}` 自动推导（如 `plugin_309`、`workflow_1309`）。
 */
export function platformToolName(ref: { targetType: string; targetId: number | string }): string {
  return `${ref.targetType}_${ref.targetId}`;
}

/** @deprecated 用 {@link platformToolName}；保留向后兼容。 */
export function resolvePlatformToolNames(ref: PlatformToolRef): string[] {
  return [platformToolName(ref)];
}

/**
 * 把 spec.tools 固化的平台工具引用（开发期 `get-config --key tools --full` 拉取的真实配置）
 * 展开为可执行 descriptor。一个 ref（targetType+targetId）→ 一个 descriptor；
 * 工具名自动拼；`method` / `url` / `auth` / 参数 schema 从 `schema` 解析（支持
 * `{ method, url, authorization, requestBody.params }` 这种平台接口定义结构）。
 */
export function createPlatformToolDescriptors(refs: PlatformToolRef[]): PlatformToolDescriptor[] {
  const descriptors: PlatformToolDescriptor[] = [];
  for (const ref of refs) {
    const parsedSchema = toObject(ref.schema);
    const requestBody = toObject(parsedSchema?.requestBody);
    const inputSchema =
      toObject(requestBody?.params) ??
      toObject(ref.inputSchema) ??
      toObject(parsedSchema?.inputSchema) ??
      toObject(parsedSchema?.input);
    descriptors.push({
      toolName: platformToolName(ref),
      targetType: ref.targetType,
      targetId: ref.targetId,
      displayName: ref.name,
      description: ref.description,
      rawSchema: ref.schema,
      inputSchema,
      method: typeof parsedSchema?.method === "string" ? parsedSchema.method : ref.method,
      url: typeof parsedSchema?.url === "string" ? parsedSchema.url : ref.url,
      auth:
        typeof parsedSchema?.authorization === "string" ? parsedSchema.authorization : ref.auth,
    });
  }
  return descriptors;
}
