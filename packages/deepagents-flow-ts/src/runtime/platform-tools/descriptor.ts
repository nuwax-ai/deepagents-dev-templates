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

export function resolvePlatformToolNames(ref: PlatformToolRef): string[] {
  const names = [...(ref.toolNames ?? []), ...(ref.names ?? [])]
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);
  return [...new Set(names)];
}

export function createPlatformToolDescriptors(refs: PlatformToolRef[]): PlatformToolDescriptor[] {
  const descriptors: PlatformToolDescriptor[] = [];
  for (const ref of refs) {
    const names = resolvePlatformToolNames(ref);
    if (!names.length) continue;
    const parsedSchema = toObject(ref.schema);
    const inputSchema = toObject(ref.inputSchema) ?? parsedSchema?.inputSchema ?? parsedSchema?.input;
    for (const toolName of names) {
      descriptors.push({
        toolName,
        targetType: ref.targetType,
        targetId: ref.targetId,
        displayName: ref.name,
        description: ref.description,
        rawSchema: ref.schema,
        inputSchema,
        outputSchema: ref.outputSchema,
        method: ref.method,
        url: ref.url,
        auth: ref.auth,
      });
    }
  }
  return descriptors;
}
