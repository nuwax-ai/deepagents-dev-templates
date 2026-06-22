/**
 * Harness Conventions
 *
 * Agent-universal conventions (tool-selection priority + secret handling) that
 * every agent this template builds should follow.
 *
 * Injection: appended directly to the resolved system prompt in the ACP
 * session-prompt branch (`resolveSystemPrompt` when `sessionConfig.systemPrompt`
 * is set). External scenario / target-agent prompts arrive via ACP — they do
 * not carry this template's bundled conventions, so we append them here.
 *
 * For the bundled flow prompt (`prompts/flow.base.md`) these conventions already
 * live in the file; this constant specifically covers the ACP session-prompt path.
 */

/** Harness-level rules injected into ACP-delivered prompts. Kept small — not agent identity. */
export const PLATFORM_CONVENTIONS = `\
## Tool Selection Priority (MANDATORY)
1. MCP tools — check bound/native MCP tools first via \`mcp_tool_bridge\` or direct bindings.
2. Built-in tools — \`http_request\`, \`json_utils\`, \`mcp_tool_bridge\`, bash / filesystem / search.
3. deepagents built-in tools — \`read_file\`, \`write_file\`, \`edit_file\`, \`execute\`, \`task\`.
4. Write custom code — only when no existing tool fits the need.

## Secrets
- Never hardcode API keys or secrets. Use environment variables or ask the user to configure them.`;
