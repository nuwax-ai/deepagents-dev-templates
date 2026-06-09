/**
 * Large Output Eviction Middleware
 *
 * Automatically evicts oversized tool outputs to the backend filesystem,
 * replacing them with compact previews. Inspired by pydantic-deepagents'
 * EvictionCapability.
 *
 * Strategy:
 * - Monitor tool output size after each tool call
 * - When output exceeds token threshold, write to backend
 * - Replace original output with preview + file path reference
 * - Agent can read full content via read_file if needed
 *
 * This prevents a single large tool output from blowing up the context window.
 */

import { createMiddleware, ToolMessage } from "langchain";
import type { EvictionConfig } from "../config/config-loader.js";
import { logger } from "../logger.js";

export interface EvictionOptions {
  config: EvictionConfig;
  /** Backend for writing evicted files. Optional — if not provided, eviction is disabled. */
  backend?: {
    write(path: string, content: string): Promise<void>;
  };
}

/**
 * Check if content should be evicted based on size.
 */
export function shouldEvict(
  content: string,
  config: EvictionConfig
): boolean {
  if (!config.enabled) return false;
  const estimatedTokens = content.length / config.charPerToken;
  return estimatedTokens > config.tokenLimit;
}

/**
 * Create a preview of evicted content (head + tail lines).
 */
export function createPreview(
  content: string,
  config: Pick<EvictionConfig, "headLines" | "tailLines">
): string {
  const lines = content.split("\n");

  if (lines.length <= config.headLines + config.tailLines) {
    return content;
  }

  const head = lines.slice(0, config.headLines).join("\n");
  const tail = lines.slice(-config.tailLines).join("\n");
  const omitted = lines.length - config.headLines - config.tailLines;

  return `${head}\n\n... [${omitted} lines truncated] ...\n\n${tail}`;
}

/**
 * Build the replacement message for an evicted tool result.
 */
export function buildEvictedMessage(
  toolCallId: string,
  toolName: string,
  filePath: string,
  preview: string
): ToolMessage {
  return new ToolMessage({
    content: `Tool result too large, saved to: ${filePath}

Read the full result using read_file with offset and limit parameters.
Example: read_file(path="${filePath}", offset=0, limit=100)

Preview (head/tail):

${preview}`,
    tool_call_id: toolCallId,
    name: toolName,
  });
}

/**
 * Create an eviction middleware that handles large tool outputs.
 */
export function createEvictionMiddleware(options: EvictionOptions) {
  const { config, backend } = options;
  const log = logger.child("eviction");

  // Track evicted tool call IDs to prevent double-eviction
  const evictedIds = new Set<string>();

  return createMiddleware({
    name: "eviction",

    beforeAgent: async () => {
      evictedIds.clear();
    },

    wrapToolCall: async (request, handler) => {
      // Execute tool normally
      const result = await handler(request);

      if (!config.enabled || !backend) {
        return result;
      }

      const toolCallId = request.toolCall.id;
      if (!toolCallId || evictedIds.has(toolCallId)) {
        return result;
      }

      // Extract content from result
      let content = "";
      if (result instanceof ToolMessage) {
        content = typeof result.content === "string"
          ? result.content
          : JSON.stringify(result.content);
      } else if (typeof result === "string") {
        content = result;
      } else {
        return result;
      }

      // Check if eviction needed
      if (!shouldEvict(content, config)) {
        return result;
      }

      // Build file path
      const sanitizedId = toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_");
      const filePath = `${config.evictionPath}/${sanitizedId}.txt`;

      try {
        // Write to backend
        await backend.write(filePath, content);
        evictedIds.add(toolCallId);

        // Generate preview
        const preview = createPreview(content, config);

        log.info("Evicted large tool output", {
          tool: request.toolCall.name,
          toolCallId,
          filePath,
          originalChars: content.length,
          previewChars: preview.length,
        });

        // Return replacement message
        return buildEvictedMessage(
          toolCallId,
          request.toolCall.name,
          filePath,
          preview
        );
      } catch (err) {
        log.error("Eviction failed, preserving original content", {
          tool: request.toolCall.name,
          toolCallId,
          error: err instanceof Error ? err.message : String(err),
        });
        // Fallback: return original result
        return result;
      }
    },
  });
}
