import { StructuredTool } from "@langchain/core/tools";
import type { PlatformToolDescriptor } from "./types.js";
import { schemaToZodInput } from "./schema-to-zod.js";

interface CreatePlatformStructuredToolOptions {
  descriptor: PlatformToolDescriptor;
}

interface PluginExecuteResponse {
  success?: boolean;
  data?: unknown;
  error?: unknown;
  message?: string;
}

export function createPlatformStructuredTool({
  descriptor,
}: CreatePlatformStructuredToolOptions): StructuredTool {
  const schema = schemaToZodInput(descriptor.inputSchema ?? descriptor.rawSchema);

  return new (class extends StructuredTool {
    name = descriptor.toolName;
    description =
      descriptor.description ??
      `Execute platform ${descriptor.targetType} tool (${descriptor.targetId}) via schema-driven runtime`;
    schema = schema;

    async _call(input: Record<string, unknown>): Promise<string> {
      const baseUrl = process.env.PLATFORM_BASE_URL?.trim();
      const accessKey = process.env.SANDBOX_ACCESS_KEY?.trim();
      if (!baseUrl || !accessKey) {
        throw new Error(
          `[${descriptor.toolName}] missing env PLATFORM_BASE_URL or SANDBOX_ACCESS_KEY for platform execute`
        );
      }
      const payload = {
        targetType: descriptor.targetType,
        targetId: descriptor.targetId,
        toolName: descriptor.toolName,
        input,
      };
      const resp = await fetch(`${baseUrl}/api/v1/4sandbox/agent/plugin/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json; charset=utf-8",
          Authorization: `Bearer ${accessKey}`,
        },
        body: JSON.stringify(payload),
      });
      const result = (await resp.json()) as PluginExecuteResponse;
      if (!resp.ok) {
        throw new Error(`[${descriptor.toolName}] http ${resp.status}: ${JSON.stringify(result)}`);
      }
      if (!result?.success) {
        const msg =
          (typeof result?.message === "string" && result.message) ||
          (typeof result?.error === "string" && result.error) ||
          "platform plugin execute failed";
        throw new Error(`[${descriptor.toolName}] ${msg}`);
      }
      return JSON.stringify(result.data ?? {});
    }
  })();
}
