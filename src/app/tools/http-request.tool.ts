/**
 * HTTP Request Tool
 *
 * Generic HTTP client — built with @langchain/core/tools `tool()` helper
 * so it's fully compatible with deepagents' tool system.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const httpRequestTool = tool(
  async ({ url, method, headers, body, timeout }) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: body || undefined,
        signal: controller.signal,
      });

      const contentType = response.headers.get("content-type") || "";
      let responseBody: string;
      if (contentType.includes("application/json")) {
        const json = await response.json();
        responseBody = JSON.stringify(json, null, 2);
      } else {
        responseBody = await response.text();
      }

      // Truncate very large responses
      const maxLen = 10_000;
      if (responseBody.length > maxLen) {
        responseBody = responseBody.slice(0, maxLen) + "\n... [truncated]";
      }

      return JSON.stringify({
        status: response.status,
        statusText: response.statusText,
        body: responseBody,
      });
    } catch (err) {
      return `HTTP request failed: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      clearTimeout(timeoutId);
    }
  },
  {
    name: "http_request",
    description: `Make HTTP requests to external APIs (GET, POST, PUT, DELETE, PATCH).
Use this for API calls that don't have a dedicated platform tool or MCP tool.
Before using this tool, check if a platform plugin provides the needed functionality.`,
    schema: z.object({
      url: z.string().describe("The URL to request"),
      method: z
        .enum(["GET", "POST", "PUT", "DELETE", "PATCH"])
        .default("GET")
        .describe("HTTP method"),
      headers: z
        .record(z.string())
        .optional()
        .describe("Request headers as key-value pairs"),
      body: z.string().optional().describe("Request body (JSON string)"),
      timeout: z
        .number()
        .default(30000)
        .describe("Timeout in milliseconds"),
    }),
  }
);
