/**
 * Conversation Checkpoint Tool
 *
 * Save, list, and restore conversation checkpoints.
 * Checkpoints capture the current conversation state so the agent
 * can recover from mistakes or explore alternative approaches.
 *
 * Inspired by pydantic-deepagents' CheckpointToolset.
 *
 * Note: Rewind works by providing the checkpoint content for the agent
 * to reference. True state restoration requires application-level support
 * (e.g., starting a new ACP session with checkpoint context).
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { resolve, basename } from "node:path";
import { ensureSessionState, getRuntimeStorage, legacyCheckpointsDir } from "../../runtime/storage/runtime-storage.js";

/** Sanitize checkpoint ID to prevent path traversal */
function sanitizeId(id: string): string {
  // Strip path separators and traversal sequences; keep only the basename
  return basename(id).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function generateCheckpointId(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 6);
  return `cp-${ts}-${rand}`;
}

export const checkpointTool = tool(
  async ({ operation, checkpointId, description, maxResults }) => {
    const storage = getRuntimeStorage();
    const dir = storage.checkpointsDir;

    try {
      switch (operation) {
        case "save": {
          ensureSessionState(storage);
          mkdirSync(dir, { recursive: true });
          const id = generateCheckpointId();
          const checkpointPath = resolve(dir, `${id}.md`);

          const content = [
            `# Checkpoint: ${id}`,
            `Created: ${new Date().toISOString()}`,
            description ? `Description: ${description}` : "",
            "",
            "## Context",
            "This checkpoint was saved so the conversation can be rewound to this point.",
            "To rewind: use the `rewind_to` operation with this checkpoint ID.",
            "",
            "## State Snapshot",
            "The agent should describe the current state here when saving:",
            "- What has been done so far",
            "- What remains to be done",
            "- Any important decisions made",
            "- Key file paths or code references",
          ].filter(Boolean).join("\n");

          writeFileSync(checkpointPath, content, "utf-8");
          return `Checkpoint saved: ${id}\nPath: ${checkpointPath}\nUse this ID to rewind later.`;
        }

        case "list": {
          const legacyDir = legacyCheckpointsDir(storage.workspaceRoot);
          const activeFiles = existsSync(dir)
            ? readdirSync(dir).filter(f => f.startsWith("cp-") && f.endsWith(".md"))
            : [];
          const legacyFiles = existsSync(legacyDir)
            ? readdirSync(legacyDir).filter(f => f.startsWith("cp-") && f.endsWith(".md"))
            : [];
          const files = [...new Set([...activeFiles, ...legacyFiles])]
            .sort()
            .reverse()
            .slice(0, maxResults ?? 10);

          if (files.length === 0) {
            return "No checkpoints found. Use `save` to create one.";
          }

          const listings = files.map(f => {
            const activePath = resolve(dir, f);
            const checkpointPath = existsSync(activePath) ? activePath : resolve(legacyDir, f);
            const content = readFileSync(checkpointPath, "utf-8");
            const descMatch = content.match(/^Description: (.+)$/m);
            const timeMatch = content.match(/^Created: (.+)$/m);
            const id = f.replace(".md", "");
            return `- ${id} (${timeMatch?.[1] ?? "unknown time"})${descMatch ? `: ${descMatch[1]}` : ""}`;
          });

          return `Checkpoints (${files.length}):\n${listings.join("\n")}`;
        }

        case "rewind": {
          if (!checkpointId) return "Error: checkpointId is required for rewind operation";
          const safeId = sanitizeId(checkpointId);
          const checkpointPath = resolve(dir, `${safeId}.md`);
          const legacyPath = resolve(legacyCheckpointsDir(storage.workspaceRoot), `${safeId}.md`);
          const readablePath = existsSync(checkpointPath) ? checkpointPath : legacyPath;
          if (!existsSync(readablePath)) {
            const available = existsSync(dir)
              ? readdirSync(dir).filter(f => f.startsWith("cp-")).map(f => f.replace(".md", ""))
              : [];
            return `Checkpoint "${safeId}" not found. Available: ${available.join(", ") || "none"}`;
          }

          const content = readFileSync(readablePath, "utf-8");
          return [
            `REWINDING TO CHECKPOINT: ${safeId}`,
            "",
            content,
            "",
            "---",
            "You are now rewound to this checkpoint. Continue from where this checkpoint was saved.",
            "Ignore any work done AFTER this checkpoint. Start fresh from the state described above.",
          ].join("\n");
        }

        case "delete": {
          if (!checkpointId) return "Error: checkpointId is required for delete operation";
          const safeId = sanitizeId(checkpointId);
          const deletePath = resolve(dir, `${safeId}.md`);
          if (!existsSync(deletePath)) {
            return `Checkpoint "${safeId}" not found in active session storage. Legacy checkpoints are read-only; run /migrate-state first.`;
          }
          unlinkSync(deletePath);
          return `Checkpoint "${checkpointId}" deleted.`;
        }

        default:
          return `Unknown operation: ${operation}`;
      }
    } catch (err) {
      return `Checkpoint operation failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
  {
    name: "conversation_checkpoint",
    description: `Save, list, rewind to, or delete conversation checkpoints.
Checkpoints capture the current state so you can recover from mistakes or try alternatives.
Operations:
- save: Save a checkpoint of the current conversation state
- list: List all saved checkpoints
- rewind: Rewind to a specific checkpoint (restores context)
- delete: Delete a checkpoint

Checkpoints are stored under ~/.deepagents/workspaces/<workspace>/sessions/<session>/checkpoints/.
Legacy .agent-checkpoints/ files are readable until migrated.`,
    schema: z.object({
      operation: z.enum(["save", "list", "rewind", "delete"]).describe("Operation type"),
      checkpointId: z.string().optional().describe("Checkpoint ID (required for rewind/delete)"),
      description: z.string().optional().describe("Description for save operation"),
      maxResults: z.number().optional().describe("Max results for list (default: 10)"),
    }),
  }
);
