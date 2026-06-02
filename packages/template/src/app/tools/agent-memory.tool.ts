/**
 * Agent Memory Tool
 *
 * Provides read/write/update operations for per-agent memory files.
 * Memory is stored at .agent-memory/{agent-name}/MEMORY.md
 * and persists across conversations.
 *
 * Inspired by pydantic-deepagents' AgentMemoryToolset.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const MEMORY_DIR = ".agent-memory";

function getMemoryPath(agentName: string): string {
  return resolve(process.cwd(), MEMORY_DIR, agentName, "MEMORY.md");
}

export const agentMemoryTool = tool(
  async ({ operation, key, content }) => {
    const agentName = process.env.ACP_AGENT_NAME || "default";
    const memoryPath = getMemoryPath(agentName);

    try {
      switch (operation) {
        case "read": {
          if (!existsSync(memoryPath)) {
            return "No memory file found. Use write_memory to create one.";
          }
          const fullContent = readFileSync(memoryPath, "utf-8");
          if (key) {
            // Extract specific section by key (## heading)
            const regex = new RegExp(`## ${key}\\n([\\s\\S]*?)(?=\\n## |$)`, "i");
            const match = fullContent.match(regex);
            return match ? match[1]!.trim() : `Section "${key}" not found in memory.`;
          }
          return fullContent;
        }

        case "write": {
          if (!content) return "Error: content is required for write operation";
          mkdirSync(dirname(memoryPath), { recursive: true });
          if (key) {
            // Write/update a specific section
            let existing = "";
            if (existsSync(memoryPath)) {
              existing = readFileSync(memoryPath, "utf-8");
            }
            const regex = new RegExp(`## ${key}\\n[\\s\\S]*?(?=\\n## |$)`, "i");
            const section = `## ${key}\n${content}\n`;
            if (regex.test(existing)) {
              existing = existing.replace(regex, section);
            } else {
              existing = existing.trimEnd() + "\n\n" + section;
            }
            writeFileSync(memoryPath, existing, "utf-8");
            return `Updated section "${key}" in memory.`;
          } else {
            writeFileSync(memoryPath, content, "utf-8");
            return "Memory file written.";
          }
        }

        case "list": {
          if (!existsSync(memoryPath)) {
            return "No memory file found.";
          }
          const fileContent = readFileSync(memoryPath, "utf-8");
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

Memory persists across conversations at .agent-memory/{agent-name}/MEMORY.md`,
    schema: z.object({
      operation: z.enum(["read", "write", "list"]).describe("Operation: read, write, or list"),
      key: z.string().optional().describe("Section key (## heading). For read: extract section. For write: update/append section."),
      content: z.string().optional().describe("Content to write. Required for write operation."),
    }),
  }
);
