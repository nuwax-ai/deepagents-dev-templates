/**
 * Agent Memory Tool
 *
 * Provides read/write/update operations for per-agent memory files.
 * Memory is stored at ~/.deepagents/workspaces/<workspace>/memory/{agent-name}/MEMORY.md
 * and persists across conversations.
 *
 * Inspired by pydantic-deepagents' AgentMemoryToolset.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { memoryPath, readableMemoryPath } from "@runtime/storage/runtime-storage.js";

/** Escape regex metacharacters in a string for safe use in RegExp */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolve agent name with unique fallback to avoid collisions */
function resolveAgentName(): string {
  return process.env.ACP_AGENT_NAME
    || process.env.ACP_SESSION_ID
    || `agent-${process.pid}`;
}

export const agentMemoryTool = tool(
  async ({ operation, key, content }) => {
    const agentName = resolveAgentName();
    const writePath = memoryPath(agentName);
    const readPath = readableMemoryPath(agentName);

    try {
      switch (operation) {
        case "read": {
          if (!existsSync(readPath)) {
            return "No memory file found. Use write_memory to create one.";
          }
          const fullContent = readFileSync(readPath, "utf-8");
          if (key) {
            const escaped = escapeRegex(key);
            const regex = new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`, "i");
            const match = fullContent.match(regex);
            return match ? match[1]!.trim() : `Section "${key}" not found in memory.`;
          }
          return fullContent;
        }

        case "write": {
          if (!content) return "Error: content is required for write operation";
          mkdirSync(dirname(writePath), { recursive: true });
          if (key) {
            const escaped = escapeRegex(key);
            let existing = "";
            if (existsSync(writePath)) {
              existing = readFileSync(writePath, "utf-8");
            } else if (existsSync(readPath)) {
              existing = readFileSync(readPath, "utf-8");
            }
            const regex = new RegExp(`## ${escaped}\\n[\\s\\S]*?(?=\\n## |$)`, "i");
            const section = `## ${key}\n${content}\n`;
            if (regex.test(existing)) {
              existing = existing.replace(regex, section);
            } else {
              existing = existing.trimEnd() + "\n\n" + section;
            }
            writeFileSync(writePath, existing, "utf-8");
            return `Updated section "${key}" in memory.\nPath: ${writePath}`;
          } else {
            writeFileSync(writePath, content, "utf-8");
            return `Memory file written.\nPath: ${writePath}`;
          }
        }

        case "list": {
          if (!existsSync(readPath)) {
            return "No memory file found.";
          }
          const fileContent = readFileSync(readPath, "utf-8");
          const headings = fileContent.match(/^## .+$/gm);
          if (!headings || headings.length === 0) {
            return "Memory file exists but has no sections.";
          }
          return headings.map(h => h.replace("## ", "- ")).join("\n");
        }

        default:
          return `Unknown operation: ${operation}`;
      }
    } catch (err) {
      return `Memory operation failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: "agent_memory",
    description: `Manage persistent agent memory. Operations:
- read: Read all memory or a specific section by key
- write: Write/append content, optionally to a specific section (by key)
- list: List all memory section headings

Memory persists across conversations at ~/.deepagents/workspaces/<workspace>/memory/{agent-name}/MEMORY.md.
Legacy .agent-memory/{agent-name}/MEMORY.md is read when the new path is empty.`,
    schema: z.object({
      operation: z.enum(["read", "write", "list"]).describe("Operation: read, write, or list"),
      key: z.string().optional().describe("Section key (## heading). For read: extract section. For write: update/append section."),
      content: z.string().optional().describe("Content to write. Required for write operation."),
    }),
  }
);
