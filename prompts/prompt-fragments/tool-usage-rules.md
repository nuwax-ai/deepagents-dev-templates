# Tool Usage Rules

## Tool Selection Priority (MANDATORY ORDER)

When you need a tool or capability, follow this exact priority:

### 1. Platform MCP Tools (CHECK FIRST)
Platform-configured plugins are exposed as MCP servers. Always search for existing tools:
```
platform_api(operation: "query_plugins", params: { query: "<what you need>" })
```
If a matching plugin exists, use it via:
- `mcp_tool_bridge` for MCP-type plugins
- `platform_api(operation: "execute_plugin")` for API-type plugins

### 2. Built-in Custom Tools
These tools are always available:
| Tool | Use For |
|------|---------|
| `http_request` | Generic HTTP calls (GET, POST, PUT, DELETE) |
| `platform_api` | Platform operations (save prompt, query plugins, variables) |
| `agent_variable` | Create/read/update agent configuration variables |
| `mcp_tool_bridge` | Discover and call MCP server tools |
| `json_utils` | JSON parsing, validation, transformation |

### 3. deepagents Built-in Tools
Provided by the deepagents framework:
| Tool | Use For |
|------|---------|
| `read_file` / `write_file` / `edit_file` | File operations |
| `ls` / `glob` / `grep` | File discovery and search |
| `execute` | Run shell commands (npm, node, etc.) |
| `write_todos` | Task planning and progress tracking |
| `task` | Delegate to sub-agents with isolated context |

### 4. Write Custom Code (LAST RESORT)
Only if NO existing tool provides the needed functionality:
1. Create a new tool file in `src/app/tools/{name}.tool.ts`
2. Follow the `_example.tool.ts` template
3. Register it in `src/app/tools/index.ts`
4. If it needs external API keys → create agent variables first

## Rules
- ❌ Never hardcode API keys or secrets in tool code
- ❌ Never write custom HTTP tools without checking platform plugins first
- ✅ Always use agent variables for external credentials
- ✅ Always document new tools with clear descriptions and examples
