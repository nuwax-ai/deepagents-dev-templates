/**
 * Task Tool
 *
 * Delegates a task to a specialized subagent and returns the result.
 * Subagents are discovered from .agents/agents/<name>/AGENT.md or
 * can be defined inline with a custom systemPrompt.
 *
 * The subagent runs as a pure LLM (no tools) for isolation and safety.
 * For subagents that need tool access, extend this tool in the ai-editable
 * zone or wire up a full createAppAgent call instead.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createDeepAgent } from "deepagents";
import { resolveModel } from "../../runtime/model.js";
import { discoverSubAgents } from "../../runtime/discovery.js";
import type { AppConfig } from "../../runtime/config/config-loader.js";
import { logger } from "../../runtime/logger.js";

export function createTaskTool(config: AppConfig, workspaceRoot: string) {
  return tool(
    async ({ subagent, prompt, systemPrompt: systemPromptOverride }) => {
      const log = logger.child("task-tool");

      // 1. Resolve system prompt
      let systemPrompt: string | undefined = systemPromptOverride;
      if (!systemPrompt && subagent) {
        const subagents = discoverSubAgents(config, workspaceRoot);
        const found = subagents.find((a) => a.name === subagent);
        if (!found) {
          const available = subagents.map((a) => a.name).join(", ");
          return `Subagent "${subagent}" not found. Available: ${available || "none — define subagents in .agents/agents/*/AGENT.md"}`;
        }
        systemPrompt = found.systemPrompt;
        log.info("Delegating to discovered subagent", { subagent, prompt: prompt.slice(0, 80) });
      } else if (systemPrompt) {
        log.info("Delegating to ad-hoc subagent", { prompt: prompt.slice(0, 80) });
      } else {
        log.info("Delegating to default assistant", { prompt: prompt.slice(0, 80) });
      }

      // 2. Spin up a minimal agent (LLM-only, no tools) for isolation.
      //    checkpointer=false avoids MemorySaver.put errors when no thread_id is provided.
      const agent = createDeepAgent({
        model: resolveModel(config),
        systemPrompt:
          systemPrompt ??
          "You are a helpful assistant. Complete the given task thoroughly and concisely.",
        tools: [],
        checkpointer: false,
      });

      // 3. Invoke and extract response text
      try {
        const result = await agent.invoke({ messages: [{ role: "user", content: prompt }] });
        const text = extractLastAiText(result);
        return text ?? "[Subagent returned no text response]";
      } catch (err) {
        log.error("Subagent execution failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return `Subagent execution failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "task",
      description: `Delegate a task to a specialized subagent and return the result.

Use this to break complex work into focused subtasks:
- Specify a \`subagent\` name (discovered from .agents/agents/<name>/AGENT.md) for a pre-configured specialist
- Or provide a \`systemPrompt\` directly to create an ad-hoc specialist inline

The subagent runs in isolation (LLM-only, no tool access by default) and returns a text result.
Best for research, analysis, summarization, drafting, and other pure-reasoning tasks.

Examples:
  { "subagent": "researcher", "prompt": "Find the rate limit docs for the GitHub API" }
  { "systemPrompt": "You are a security reviewer. Check for OWASP top-10 vulnerabilities only.", "prompt": "<code here>" }
  { "prompt": "Summarize the key decisions from this architecture document: <doc>" }`,
      schema: z.object({
        subagent: z
          .string()
          .optional()
          .describe("Name of a discovered subagent from .agents/agents/<name>/AGENT.md"),
        prompt: z.string().describe("The task to delegate to the subagent"),
        systemPrompt: z
          .string()
          .optional()
          .describe(
            "Ad-hoc system prompt for an inline specialist — use when no pre-defined subagent fits"
          ),
      }),
    }
  );
}

// ─── Helpers ──────────────────────────────────────────────

/**
 * Extract the text of the last AI message from a deepagents invoke result.
 * Returns the trimmed text, or null if no text content was produced.
 *
 * deepagents returns `{ messages: BaseMessage[] }`; an AI message's `content`
 * is either a string or an array of content blocks (text/image/tool_use/...).
 * We pick text blocks explicitly so a trailing tool_use block can't mask the
 * answer, and we look at the LAST ai message so tool-call turns are skipped.
 */
function extractLastAiText(response: unknown): string | null {
  const messages = (response as { messages?: unknown[] })?.messages;
  if (!Array.isArray(messages)) return null;

  for (const m of [...messages].reverse()) {
    if (!isAiMessage(m)) continue;
    const content = (m as { content?: unknown }).content;
    const text = contentToText(content);
    if (text) return text;
  }
  return null;
}

function isAiMessage(m: unknown): boolean {
  if (typeof m !== "object" || m === null) return false;
  const msg = m as { type?: string; _getType?: () => string };
  return msg.type === "ai" || msg._getType?.() === "ai";
}

function contentToText(content: unknown): string | null {
  if (typeof content === "string") {
    return content.trim() || null;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((block) => {
        if (typeof block === "string") return block;
        const b = block as { type?: string; text?: string };
        return b.type === "text" && typeof b.text === "string" ? b.text : "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
    return text || null;
  }
  return null;
}
