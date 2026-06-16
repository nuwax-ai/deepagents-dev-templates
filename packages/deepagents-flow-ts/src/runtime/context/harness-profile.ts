/**
 * Platform Conventions
 *
 * The platform-universal conventions (tool-selection priority + secret/variable
 * handling) that every agent this template builds should follow.
 *
 * Injection: these are appended directly to the resolved system prompt in the
 * one path that bypasses this template's prompt files — `resolveSystemPrompt`'s
 * ACP session-prompt branch (see `runtime/prompt.ts`), where an external
 * scenario / target-agent prompt arrives via `sessionConfig.systemPrompt`.
 *
 * Why not deepagents' harness-profile `systemPromptSuffix`? That field is
 * override-wins on merge: `resolveHarnessProfile` merges the bare-provider
 * profile (base) with the exact `provider:model` profile (override) using
 * `override.systemPromptSuffix ?? base.systemPromptSuffix`. Every built-in
 * model profile (e.g. `anthropic:claude-sonnet-4-6`) defines its own suffix, so
 * a provider-level registration is silently dropped for those models —
 * including the default `claude-sonnet-4-6`. Appending directly to the prompt
 * sidesteps the merge entirely and works for every model.
 *
 * For the bundled developer-agent prompt (the default config) these same
 * conventions already live in `prompts/developer-agent.system.md`, so the main
 * agent is covered there; this constant specifically covers the ACP
 * session-prompt case, which is the path the old (now-removed) harness-profile
 * registration was meant to cover but could not.
 *
 * Scope discipline: only platform-universal conventions belong here. Agent
 * identity, the scenario-generation workflow, and other developer-agent-specific
 * instructions stay in the per-agent system prompt (e.g.
 * `prompts/developer-agent.system.md`).
 */

/**
 * Platform-universal conventions injected into every agent. Kept intentionally
 * small — these are harness-level rules, not agent identity.
 */
export const PLATFORM_CONVENTIONS = `\
## Tool Selection Priority (MANDATORY)
1. Platform MCP tools — query platform plugins FIRST via \`platform_api\`.
2. Built-in custom tools — \`http_request\`, \`platform_api\`, \`agent_variable\`, \`json_utils\`, \`mcp_tool_bridge\`.
3. deepagents built-in tools — \`read_file\`, \`write_file\`, \`edit_file\`, \`execute\`, \`task\`.
4. Write custom code — only when no existing tool fits the need.

## Secrets & Variables
- When a tool needs an API key or secret, create an agent variable via \`agent_variable(operation: "create", ...)\` — never hardcode secrets.
- Agent variables are filled in by the user through the platform UI.`;
