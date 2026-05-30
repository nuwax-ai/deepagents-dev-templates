---
name: mcp-integration
description: "Generate MCP configuration, tool naming conventions, and server lifecycle management"
tags: [platform, mcp, configuration, integration]
version: "1.0.0"
---

# MCP Integration

## When to Use
When adding, configuring, or debugging MCP (Model Context Protocol) server integrations.

## MCP Configuration Format

### Default Config (`config/mcp.default.json`)
```json
{
  "servers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "description": "Query latest framework/API docs"
    }
  }
}
```

### Server Types

**Stdio Server** (local process):
```json
{
  "command": "npx",
  "args": ["-y", "package-name"],
  "env": { "API_KEY": "${AGENT_VAR_MY_KEY}" }
}
```

**HTTP Server** (remote):
```json
{
  "url": "https://mcp.example.com",
  "auth": { "type": "env", "var": "MCP_AUTH_TOKEN" }
}
```

## Merge Strategy
MCP configs are merged in this order (later wins):
1. `config/mcp.default.json` — always included
2. Platform-delivered MCPs — from Nuwax API
3. ACP session overrides — from editor/client

Configure strategy in `app-agent.config.json`:
```json
{
  "mcp": {
    "mergeStrategy": "session-wins"
  }
}
```

## Tool Naming Convention
When calling MCP tools:
- Server name + tool name: `server_name.tool_name`
- Use `mcp_tool_bridge` to discover and call MCP tools
- Platform plugins appear as MCP servers with `nuwax-` prefix

## Debugging MCP Issues
1. Check server is configured: `MCPManager.listServers()`
2. Verify connection: check logs for connection errors
3. Test tool call: `mcp_tool_bridge(operation: "call_tool", ...)`
4. Check auth: verify env vars are set for authenticated servers

## Common Issues
| Issue | Cause | Fix |
|-------|-------|-----|
| Server not found | Missing from config | Add to mcp.default.json or platform |
| Auth failed | Missing env var | Create agent variable for the token |
| Timeout | Server too slow | Increase timeout or check server health |
| Tool not found | Wrong tool name | Use list_tools to discover available tools |
