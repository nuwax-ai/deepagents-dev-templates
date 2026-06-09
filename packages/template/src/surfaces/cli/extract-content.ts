/**
 * Extract text content from an agent invoke response.
 * Handles various response formats from different deepagents versions.
 */
export function extractContent(response: unknown): string {
  if (!response) return "(no response)";

  if (typeof response === "string") return response;

  // LangChain message array response
  if (Array.isArray(response)) {
    return response
      .map((m: unknown) => extractContent(m))
      .filter(Boolean)
      .join("\n");
  }

  // Object with messages array
  const r = response as { messages?: unknown[]; content?: unknown; text?: unknown };
  if (Array.isArray(r.messages)) {
    return r.messages
      .map((m: unknown) => extractContent(m))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof r.content === "string") return r.content;
  if (typeof r.text === "string") return r.text;

  // Array of content blocks
  if (Array.isArray(r.content)) {
    return r.content
      .map((b: unknown) => {
        if (typeof b === "string") return b;
        const block = b as { type?: string; text?: string };
        if (block.type === "text" && typeof block.text === "string") return block.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  // Fallback: stringify
  try {
    return JSON.stringify(response, null, 2);
  } catch {
    return String(response);
  }
}
