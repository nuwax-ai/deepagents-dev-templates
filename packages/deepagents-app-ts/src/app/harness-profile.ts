/**
 * App Harness Profile
 *
 * Registers a deepagents *harness profile* — the official mechanism
 * (`registerHarnessProfile`) for model/harness-level prompt and tool
 * customization. The profile's `systemPromptSuffix` is appended after
 * deepagents' built-in `BASE_AGENT_PROMPT` and applied uniformly to EVERY agent
 * this template builds: the main agent, declarative subagents, and the
 * auto-added general-purpose subagent.
 *
 * Why this matters here: in ACP mode the main system prompt is the *scenario
 * target agent* prompt supplied by the client, which does not carry this
 * template's platform conventions. Injecting them via the harness profile means
 * the platform tool-priority and secret-handling rules apply to every agent
 * regardless of which main prompt is in effect (ACP target agent or the bundled
 * developer-agent prompt used in CLI modes).
 *
 * Scope discipline: only platform-universal conventions belong here. Agent
 * identity, the scenario-generation workflow, and other developer-agent-specific
 * instructions stay in the per-agent system prompt (e.g.
 * `prompts/developer-agent.system.md`), not in this shared suffix.
 */

import { registerHarnessProfile } from "deepagents";
import type { AppConfig } from "../runtime/config/config-loader.js";
import { logger } from "../runtime/logger.js";

/**
 * Platform-universal conventions injected into every agent. Kept intentionally
 * small — these are harness-level rules, not agent identity.
 */
const PLATFORM_CONVENTIONS = `\
## Tool Selection Priority (MANDATORY)
1. Platform MCP tools — query platform plugins FIRST via \`platform_api\`.
2. Built-in custom tools — \`http_request\`, \`platform_api\`, \`agent_variable\`, \`json_utils\`, \`mcp_tool_bridge\`.
3. deepagents built-in tools — \`read_file\`, \`write_file\`, \`edit_file\`, \`execute\`, \`task\`.
4. Write custom code — only when no existing tool fits the need.

## Secrets & Variables
- When a tool needs an API key or secret, create an agent variable via \`agent_variable(operation: "create", ...)\` — never hardcode secrets.
- Agent variables are filled in by the user through the platform UI.`;

// Track which provider keys we've already registered this process. The registry
// merges additively (a repeat registration is harmless), but the guard avoids
// redundant work and log noise across the many agent constructions per process.
const registeredProviders = new Set<string>();

/**
 * Register the app harness profile for the configured model provider.
 *
 * Registers under the bare provider key (e.g. `"anthropic"`) so it merges with
 * any built-in per-model profile (e.g. `anthropic:claude-sonnet-4-6`) during
 * `resolveHarnessProfile`. The provider is resolved from a model instance via
 * deepagents' `getModelProvider`, which maps `ChatAnthropic → "anthropic"` and
 * `ChatOpenAI → "openai"`, matching the keys we register here.
 *
 * Idempotent per provider; safe to call on every agent build.
 */
export function registerAppHarnessProfile(config: AppConfig): void {
  const provider = config.model.provider;
  if (registeredProviders.has(provider)) {
    return;
  }
  registeredProviders.add(provider);

  registerHarnessProfile(provider, {
    systemPromptSuffix: PLATFORM_CONVENTIONS,
  });

  logger.child("harness-profile").info("Registered app harness profile", { provider });
}
