# Platform Rules

These rules apply to all agents integrated with the Nuwax platform via nuwaclaw.

## Platform Integration Rules

### Tool Priority
1. **Always check platform first** — Before writing any custom tool code, query the platform for existing plugins that provide the needed functionality.
2. **Use MCP for platform tools** — Platform-configured plugins are exposed as MCP servers.
3. **Variables for secrets** — Any API key, token, or credential must be stored as an agent variable, never hardcoded.

### Prompt Management
- Agent prompts are delivered via ACP session metadata from the platform.
- AI-generated prompts must be saved to the platform via `platform_api(operation: "save_prompt")`.
- Never hardcode the target agent's system prompt in runtime code.

### Component Binding
- Use `platform_api(operation: "bind_component")` to connect platform components to the agent.
- Components include: knowledge bases, form builders, workflow triggers.

### Debug Mode
- Use `platform_api(operation: "create_debug_session")` for testing.
- Debug sessions run through the full ACP flow (same as production).
- All platform API calls are logged and auditable.

## Constraints
- The runtime layer (`src/runtime/`) is protected — do not modify.
- Agent variables created by the AI start with empty values — users fill them via platform UI.
- MCP configurations are merged: session > platform > defaults.
