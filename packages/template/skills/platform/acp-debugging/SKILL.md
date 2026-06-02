---
name: acp-debugging
description: "Walk through the complete ACP + platform devMode debug flow for testing agents"
tags: [platform, acp, debugging, testing]
version: "1.0.0"
---

# ACP Debugging

## When to Use
When testing the agent end-to-end, debugging ACP protocol issues, or verifying the complete nuwaclaw integration flow.

## Full Debug Flow

### Step 1: Start Local ACP Server
```bash
npm run start:acp -- --debug
# or
tsx src/index.ts --debug
```
This starts the ACP server with debug logging enabled.

### Step 2: Connect ACP Client
Connect from an ACP-compatible client (Zed, JetBrains, VS Code):
```json
// Zed settings example
{
  "agent_servers": {
    "my-agent": {
      "command": "npx",
      "args": ["tsx", "src/index.ts", "--debug"],
      "cwd": "/path/to/project"
    }
  }
}
```

### Step 3: Create Platform Debug Session
```
platform_api(
  operation: "create_debug_session",
  params: { model: "anthropic:claude-sonnet-4-6" }
)
```

### Step 4: Send Test Prompts
Through the ACP client, send test prompts:
1. Simple greeting → verify basic response
2. Tool usage prompt → verify tool calls
3. Platform API prompt → verify platform integration
4. MCP tool prompt → verify MCP bridge

### Step 5: Monitor & Verify
Watch for:
- ✅ ACP handshake completes (initialize → session/new)
- ✅ Prompts are received and processed
- ✅ Tool calls appear in the ACP stream
- ✅ Platform API calls succeed
- ✅ Variables resolve correctly
- ✅ Response is streamed back to client

## Debug Checklist
- [ ] ACP server starts without errors
- [ ] Client can connect and create sessions
- [ ] System prompt is loaded (from ACP session or config)
- [ ] Tools are registered and callable
- [ ] Platform API client is authenticated
- [ ] MCP servers are connected
- [ ] Agent variables resolve to values
- [ ] Response streams back correctly

## Common ACP Issues
| Issue | Likely Cause | Fix |
|-------|-------------|-----|
| Server won't start | Missing dependency | `npm install deepagents-acp` |
| Client can't connect | Wrong command/cwd | Check ACP client settings |
| Session fails | Invalid config | Check app-agent.config.json |
| Tools not available | Import error | Check tool registration in index.ts |
| Platform calls fail | Missing auth token | Set PLATFORM_API_TOKEN env var |

## Logging
Set `LOG_LEVEL=debug` for full trace:
```bash
LOG_LEVEL=debug npm run start:acp
```
Logs include: ACP messages, tool calls, platform API calls, MCP connections, variable resolution.
