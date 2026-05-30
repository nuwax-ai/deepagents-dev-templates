---
name: platform-tool-selection
description: "Query platform plugins first before writing custom tool code — enforce tool priority"
tags: [platform, tools, mcp, priority]
version: "1.0.0"
---

# Platform Tool Selection

## When to Use
**EVERY TIME** you need a tool or capability. Before writing any custom code, check if the platform already provides it.

## Tool Priority (MANDATORY)

```
1. Platform MCP Tools     ← ALWAYS CHECK FIRST
2. Built-in Custom Tools  ← http_request, platform_api, agent_variable
3. deepagents Built-in    ← filesystem, execute, task, write_todos
4. Write Custom Code      ← LAST RESORT ONLY
```

## Process

### Step 1: Search Platform
```
platform_api(operation: "query_plugins", params: { query: "<what you need>" })
```
Search for plugins that match your need. Try multiple search terms.

### Step 2: Evaluate Results
For each plugin found:
- Does it do what I need?
- Is it an MCP plugin (directly usable as a tool)?
- Is it an API plugin (callable via platform_api execute_plugin)?
- Is it a workflow (callable via platform_api execute_plugin)?

### Step 3: Use Platform Tool
If a matching plugin exists:
- For MCP plugins: Use via `mcp_tool_bridge` or direct MCP connection
- For API plugins: Use `platform_api(operation: "execute_plugin", params: { pluginId, params })`
- For workflows: Same as API plugins

### Step 4: Custom Code (only if no platform match)
If NO platform plugin matches:
1. Write the custom tool in `src/app/tools/`
2. If it needs external API keys: create an agent variable first
3. Register the tool in the tool registry

## Example
```
# Need: Send an email
# Step 1: Search platform
platform_api(operation: "query_plugins", params: { query: "email send" })

# Result: Found "nuwax-email-plugin" (MCP type)
# Step 2: Use it
mcp_tool_bridge(operation: "call_tool", server: "nuwax-email-plugin", tool: "send_email", args: {...})

# If no plugin found:
# Step 4: Write custom tool
# → Create src/app/tools/email.tool.ts
# → agent_variable(operation: "create", name: "EMAIL_API_KEY", ...)
# → Implement using http_request with the API key variable
```

## Anti-patterns
- ❌ Writing custom HTTP calls without checking for platform plugins
- ❌ Hardcoding API keys in tool code (use agent variables!)
- ❌ Ignoring MCP tools that are already configured
