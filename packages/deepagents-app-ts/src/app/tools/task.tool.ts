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
      const agentInstance = (createDeepAgent as unknown as (params: unknown) => unknown)({
        model: resolveModel(config),
        systemPrompt:
          systemPrompt ??
          "You are a helpful assistant. Complete the given task thoroughly and concisely.",
        tools: [],
        checkpointer: false,
      });

      // 3. Invoke and extract response text
      try {
        const result = await (agentInstance as { invoke: (i: unknown) => Promise<unknown> }).invoke(
          { messages: [{ role: "human", content: prompt }] }
        );
        const messages: unknown[] = (result as { messages?: unknown[] })?.messages ?? [];
        const lastAi = [...messages]
          .reverse()
          .find(
            (m) =>
              (m as { type?: string }).type === "ai" ||
              (m as { _getType?: () => string })._getType?.() === "ai"
          ) as { content?: unknown } | undefined;

        const content = lastAi?.content;
        if (typeof content === "string") {
          return content.trim() || "[Subagent returned empty response]";
        }
        if (Array.isArray(content)) {
          return (
            (content as unknown[])
              .map((c) =>
                typeof c === "string" ? c : (c as { text?: string })?.text ?? ""
              )
              .filter(Boolean)
              .join("\n")
              .trim() || "[Subagent returned empty response]"
          );
        }
        return "[Subagent returned no text response]";
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
