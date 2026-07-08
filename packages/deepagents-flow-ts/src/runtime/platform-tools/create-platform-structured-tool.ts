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

interface SseFinalResult {
  data?: unknown;
  error?: { message?: string; code?: string };
}

/** 从 SSE 流文本提取 FinalResult 事件的 data（Workflow 流式返回，取最后一个 FinalResult）。 */
function parseSseFinalResult(text: string): SseFinalResult | undefined {
  const blocks = text.split(/\n\n+/);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const lines = blocks[i]!.split("\n");
    let event = "";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (event === "FinalResult" && dataLines.length) {
      try {
        return JSON.parse(dataLines.join("\n")) as SseFinalResult;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
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
      // url / method / authorization 从固化 schema 读，${...} 占位符由运行时 env 替换。
      // Plugin → /agent/plugin/execute，Workflow → /agent/workflow/execute（schema.url 区分）。
      const rawUrl =
        descriptor.url ??
        `${baseUrl}/api/v1/4sandbox/agent/${descriptor.targetType.toLowerCase()}/execute`;
      const url = rawUrl.replace(/\$\{PLATFORM_BASE_URL\}/g, baseUrl);
      const method = descriptor.method ?? "POST";
      const authTemplate =
        typeof descriptor.auth === "string" && descriptor.auth.length > 0
          ? descriptor.auth
          : "Bearer ${SANDBOX_ACCESS_KEY}";
      const authorization = authTemplate.replace(/\$\{SANDBOX_ACCESS_KEY\}/g, accessKey);
      // body 按 schema.requestBody 结构：{ targetType, targetId, params }（devAgentId 仅调试，不传）。
      const payload = {
        targetType: descriptor.targetType,
        targetId: descriptor.targetId,
        params: input,
      };
      const resp = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json; charset=utf-8",
          Authorization: authorization,
        },
        body: JSON.stringify(payload),
      });
      const contentType = resp.headers.get("content-type") ?? "";
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`[${descriptor.toolName}] http ${resp.status}: ${errText || contentType}`);
      }
      // Workflow 多为 SSE(text/event-stream) → 取 FinalResult；Plugin 为 JSON。
      if (contentType.includes("text/event-stream")) {
        const finalResult = parseSseFinalResult(await resp.text());
        const errMsg = finalResult?.error?.message || finalResult?.error?.code;
        if (errMsg) throw new Error(`[${descriptor.toolName}] ${errMsg}`);
        return JSON.stringify(finalResult?.data ?? finalResult ?? {});
      }
      const result = (await resp.json()) as PluginExecuteResponse;
      if (!result?.success) {
        const msg =
          (typeof result?.message === "string" && result.message) ||
          (typeof result?.error === "string" && result.error) ||
          "platform execute failed";
        throw new Error(`[${descriptor.toolName}] ${msg}`);
      }
      return JSON.stringify(result.data ?? {});
    }
  })();
}
