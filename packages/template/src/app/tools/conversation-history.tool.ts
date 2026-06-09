/**
 * Conversation History Search Tool
 *
 * Searches through archived conversation history files.
 * deepagents' summarization middleware offloads old messages to
 * /conversation_history/{thread_id}.md before compression.
 * This tool lets the agent search through that history to recover
 * details lost during summarization.
 *
 * Inspired by pydantic-deepagents' search_conversation_history tool.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getRuntimeStorage, listSessions } from "../../runtime/storage/runtime-storage.js";
import { truncate } from "../../runtime/utils/string.js";

const HISTORY_DIR = "conversation_history";

/**
 * Simple relevance scoring: count keyword occurrences.
 * Returns [line, score] pairs sorted by relevance.
 */
function searchLines(content: string, query: string, maxResults: number): string[] {
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);
  const lines = content.split("\n");

  // Score each line by keyword matches
  const scored: Array<{ line: string; lineNum: number; score: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i]!.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      if (lineLower.includes(term)) score++;
    }
    // Also check full query
    if (lineLower.includes(queryLower)) score += 3;
    if (score > 0) {
      scored.push({ line: lines[i]!, lineNum: i + 1, score });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return top results with surrounding context
  const results: string[] = [];
  const seen = new Set<number>();
  for (const { lineNum, score } of scored.slice(0, maxResults)) {
    if (seen.has(lineNum)) continue;
    seen.add(lineNum);

    // Include 2 lines of context before and after
    const start = Math.max(0, lineNum - 3);
    const end = Math.min(lines.length, lineNum + 2);
    const excerpt = lines.slice(start, end).join("\n");
    results.push(`[Line ${lineNum}, score: ${score}]\n${excerpt}`);
  }

  return results;
}

export const conversationHistoryTool = tool(
  async ({ operation, query, maxResults }) => {
    const storage = getRuntimeStorage();
    const historyDir = resolve(process.cwd(), HISTORY_DIR);

    try {
      switch (operation) {
        case "list": {
          const sessions = listSessions(storage.workspaceRoot);
          const archivedFiles = existsSync(historyDir)
            ? readdirSync(historyDir).filter(f => f.endsWith(".md"))
            : [];

          if (sessions.length > 0) {
            return [
              `Found ${sessions.length} session(s):`,
              ...sessions.map((session) =>
                `- ${session.sessionId} (${session.updatedAt ?? "unknown time"}) messages=${session.messageCount ?? 0}`
              ),
              archivedFiles.length > 0 ? `\nLegacy history files:\n${archivedFiles.map(f => `- ${f}`).join("\n")}` : "",
            ].filter(Boolean).join("\n");
          }

          if (!existsSync(historyDir)) {
            return "No conversation history found. History is created when summarization middleware offloads old messages.";
          }
          if (archivedFiles.length === 0) {
            return "No conversation history files found.";
          }
          return `Found ${archivedFiles.length} history file(s):\n${archivedFiles.map(f => `- ${f}`).join("\n")}`;
        }

        case "search": {
          if (!query) return "Error: query is required for search operation";
          const allResults: string[] = [];
          const sessionContent = readSessionMessages(storage.messagesPath);
          if (sessionContent) {
            const matches = searchLines(sessionContent, query, maxResults ?? 5);
            if (matches.length > 0) {
              allResults.push(`\n## ${storage.sessionId}/messages.jsonl`);
              allResults.push(...matches);
            }
          }

          if (!existsSync(historyDir)) {
            if (allResults.length > 0) {
              return `Search results for "${query}":\n${allResults.join("\n\n")}`;
            }
            return "No conversation history directory found.";
          }
          const files = readdirSync(historyDir).filter(f => f.endsWith(".md"));
          if (files.length === 0 && allResults.length === 0) {
            return "No conversation history files to search.";
          }

          for (const file of files) {
            const content = readFileSync(resolve(historyDir, file), "utf-8");
            const matches = searchLines(content, query, maxResults ?? 5);
            if (matches.length > 0) {
              allResults.push(`\n## ${file}`);
              allResults.push(...matches);
            }
          }

          if (allResults.length === 0) {
            return `No matches found for "${query}" in conversation history.`;
          }
          return `Search results for "${query}":\n${allResults.join("\n\n")}`;
        }

        case "read": {
          const sessionContent = readSessionMessages(storage.messagesPath);
          if (sessionContent) {
            return truncate(sessionContent, 10000);
          }
          if (!existsSync(historyDir)) {
            return "No conversation history directory found.";
          }
          const allFiles = readdirSync(historyDir).filter(f => f.endsWith(".md"));
          if (allFiles.length === 0) {
            return "No conversation history files found.";
          }
          // Read the most recent file
          const latestFile = allFiles[allFiles.length - 1]!;
          const content = readFileSync(resolve(historyDir, latestFile), "utf-8");
          return truncate(content, 10000);
        }

        default:
          return `Unknown operation: ${operation}`;
      }
    } catch (err) {
      return `History operation failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: "conversation_history",
    description: `Search and browse archived conversation history.
History is automatically created when the summarization middleware compresses old messages.
Operations:
- list: List all history archive files
- search: Search history by keyword (returns matching excerpts with context)
- read: Read the most recent history file`,
    schema: z.object({
      operation: z.enum(["list", "search", "read"]).describe("Operation: list, search, or read"),
      query: z.string().optional().describe("Search keywords (required for search operation)"),
      maxResults: z.number().optional().describe("Max results to return (default: 5)"),
    }),
  }
);

function readSessionMessages(messagesPath: string): string | null {
  if (!existsSync(messagesPath)) {
    return null;
  }
  const content = readFileSync(messagesPath, "utf-8").trim();
  return content ? content : null;
}
