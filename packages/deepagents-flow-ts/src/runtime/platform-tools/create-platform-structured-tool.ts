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
  error?: { message?: string; code?: string; [key: string]: unknown } | null;
}

/** 从 SSE 流文本提取 FinalResult 事件的 data（Workflow 流式返回，取最后一个 FinalResult）。 */
function parseSseFinalResult(text: string): SseFinalResult | undefined {
  // SSE 行尾可能是 \r\n / \r / \n，先规范化再按空行分块
  const blocks = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split(/\n\n+/);
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
      // schema.url 必须由 get-config 固化带来；缺 url 时拒绝执行（不猜测端点，避免 Knowledge 等未验证路由 404）。
      if (!descriptor.url) {
        throw new Error(
          `[${descriptor.toolName}] missing descriptor.url (spec.tools 未固化 url)`
        );
      }
      const url = descriptor.url.replace(/\$\{PLATFORM_BASE_URL\}/g, baseUrl);
      const method = descriptor.method ?? "POST";
      const authTemplate =
        typeof descriptor.auth === "string" && descriptor.auth.length > 0
          ? descriptor.auth
          : "Bearer ${SANDBOX_ACCESS_KEY}";
      const authorization = authTemplate.replace(/\$\{SANDBOX_ACCESS_KEY\}/g, accessKey);
      // body 按 schema.requestBody 结构。devAgentId 由运行时 env 注入——执行接口需它定位 plugin
      // 上下文（不带会 "Error plugin id"）；schema 注释称"仅调试"但实测执行必需。
      const devAgentId = process.env.DEV_AGENT_ID?.trim();
      const payload: Record<string, unknown> = {
        targetType: descriptor.targetType,
        targetId: descriptor.targetId,
        params: input,
      };
      if (devAgentId) payload.devAgentId = devAgentId;
      const resp = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json; charset=utf-8",
          Authorization: authorization,
        },
        body: JSON.stringify(payload),
      });
      const respText = await resp.text();
      const contentType = resp.headers.get("content-type") ?? "";
      if (!resp.ok) {
        throw new Error(`[${descriptor.toolName}] http ${resp.status}: ${respText || contentType}`);
      }
      // Workflow 多为 SSE(text/event-stream) → 取 FinalResult；Plugin 为 JSON。
      if (contentType.includes("text/event-stream")) {
        const finalResult = parseSseFinalResult(respText);
        if (!finalResult) {
          throw new Error(
            `[${descriptor.toolName}] SSE 缺 FinalResult 事件: ${respText.slice(0, 200)}`
          );
        }
        const errObj = finalResult.error;
        if (errObj) {
          throw new Error(
            `[${descriptor.toolName}] ${errObj.message ?? errObj.code ?? JSON.stringify(errObj)}`
          );
        }
        return JSON.stringify(finalResult.data ?? {});
      }
      // 非事件流：先 text 再 try JSON.parse（失败把原文当错误抛，避免网关 text/html 错误页丢失）
      let result: PluginExecuteResponse;
      try {
        result = JSON.parse(respText) as PluginExecuteResponse;
      } catch {
        throw new Error(
          `[${descriptor.toolName}] 非 JSON 响应 (${contentType}): ${respText.slice(0, 200)}`
        );
      }
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
