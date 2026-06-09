/**
 * Truncate a string to a maximum length with a suffix showing total size.
 */
export function truncate(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return `${content.slice(0, maxLength)}\n\n... [truncated, total length: ${content.length} chars]`;
}
