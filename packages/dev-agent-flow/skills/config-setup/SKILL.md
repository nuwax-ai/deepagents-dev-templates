---
name: config-setup
description: "flow-ts 配置管理：MCP 服务器（stdio/http）、合并策略、变量插值 + agent_variable 密钥管理、命名规范"
tags: [mcp, variables, secrets, configuration, platform, flow]
version: "3.0.0"
---

# 配置管理（MCP + 变量）

## When to Use
需要添加 MCP 服务器、管理 API key / 配置变量、绑定平台组件、或调试配置问题时。

---

## MCP 服务器配置

默认配置：`config/mcp.default.json`
```json
{
  "servers": {
    "context7": {
      "command": "pnpm",
      "args": ["dlx", "@upstash/context7-mcp"],
      "description": "查询最新框架/API 文档"
    }
  }
}
```

### 添加新 MCP 服务器

**Stdio 类型（本地进程）：**
```json
{
  "my-server": {
    "command": "pnpm",
    "args": ["dlx", "my-mcp-package"],
    "env": { "API_KEY": "${AGENT_VAR_MY_API_KEY}" },
    "description": "服务器功能描述"
  }
}
```

**HTTP 类型（远程服务）：**
```json
{
  "remote-server": {
    "url": "https://mcp.example.com",
    "auth": { "type": "env", "var": "MCP_AUTH_TOKEN" },
    "description": "远程 MCP 服务"
  }
}
```

### MCP 工具如何进入 flow-ts
native MCP 工具经 FlowRuntime 自动加载（`ctx.mcpTools`），合并进 `allTools`：
```
createFlowTools(ctx, opts) = [ ...通用工具, ...flow 自补工具, ...ctx.mcpTools ]
```
默认图 think 节点 `bindTools(allTools)` 后，LLM 可直接调用 MCP 工具。
自定义图节点也可经 `mcp_tool_bridge` 工具或直接 `callMcpTool` 调用（见 examples/travel-planner）。

### 合并策略（config/flow-agent.config.json）
```json
{ "mcp": { "configPath": "./config/mcp.default.json", "mergeStrategy": "session-wins" } }
```
| 策略 | 行为 |
|------|------|
| `session-wins` | ACP session 的 mcpServers 覆盖默认和平台配置 |
| `platform-wins` | 平台绑定的 MCP 覆盖 session 配置 |
| `defaults-wins` | config/mcp.default.json 优先 |

### 在节点里直接调 MCP
```typescript
import { callMcpTool } from "../mcp-client.js";
const SEARCH_MCP = { command: "npx", args: ["-y", "duckduckgo-mcp-server"] };
const result = await callMcpTool(SEARCH_MCP, "duckduckgo_search", { query }, 20000);
```

### 调试 MCP
1. `pnpm exec tsx src/index.ts capabilities`（列 MCP 服务器）
2. `mcp_tool_bridge(operation: "list_servers")`
3. `mcp_tool_bridge(operation: "call_tool", ...)`
4. stderr 搜 `mcp` 看日志

---

## 变量管理（agent_variable）

### 核心原则
- **永远不要硬编码密钥** — 所有敏感值必须通过变量管理
- **AI 创建占位，用户填写值** — 变量创建后初始值为空
- **统一命名** — UPPER_SNAKE_CASE

### 创建变量
```json
agent_variable(operation: "create", params: {
  "name": "WEATHER_API_KEY",
  "type": "secret",
  "description": "天气服务 API key，从 https://weather.com 获取"
})
```

| 类型 | 用途 | 示例 |
|------|------|------|
| `secret` | API key、token、密码 | `MY_API_KEY` |
| `string` | 普通配置值 | `DEFAULT_LANGUAGE` |
| `number` | 数值配置 | `MAX_RETRIES` |
| `boolean` | 开关配置 | `ENABLE_LOGGING` |

### 命名规范
- 格式：`UPPER_SNAKE_CASE`
- 平台相关：`PLATFORM_XXX`；第三方 API：`{SERVICE}_API_KEY`
- Agent 配置：`AGENT_XXX`；MCP 相关：`MCP_XXX`

### 读取方式
```typescript
// 方式 1：RuntimeContext（推荐，平台绑定工具）
export function createMyTool(ctx: RuntimeContext) {
  return tool(async ({ query }) => {
    const apiKey = await ctx.variableManager.get("WEATHER_API_KEY");
    if (!apiKey) return "错误：请填写 WEATHER_API_KEY";
  }, { ... });
}

// 方式 2：环境变量（无状态工具 / 图节点）
const apiKey = process.env.AGENT_VAR_WEATHER_API_KEY;
```

### 读写更新
```json
agent_variable(operation: "get", params: { "name": "WEATHER_API_KEY" })
agent_variable(operation: "set", params: { "name": "WEATHER_API_KEY", "value": "new-value" })
agent_variable(operation: "list")
```

### MCP 配置中的变量插值
MCP 配置支持 `${AGENT_VAR_XXX}` 占位符，运行时替换为 agent variable 的值：
```json
{ "env": { "API_KEY": "${AGENT_VAR_WEATHER_API_KEY}" } }
```

---

## 变量设计清单
创建新工具/节点时：
- [ ] 列出所有外部凭据
- [ ] 为每个凭据创建 agent_variable
- [ ] 命名遵循 UPPER_SNAKE_CASE
- [ ] description 说明如何获取
- [ ] 代码中有变量缺失时的错误提示
- [ ] 不硬编码任何密钥

## 常见问题
| 问题 | 原因 | 解决 |
|------|------|------|
| MCP Server not found | 未在配置添加 | 加到 mcp.default.json 或平台 |
| MCP Auth failed | 缺环境变量 | 创建 agent_variable 存 token |
| MCP Timeout | 服务器响应慢 | 增超时或查健康 |
| `const apiKey = "sk-xxx"` | 硬编码密钥 | 用 agent_variable 创建占位 |
| 变量名用驼峰 | 命名不规范 | 改 UPPER_SNAKE_CASE |

## Anti-patterns
- 直接在 env 中硬编码 API key（用 `${AGENT_VAR_XXX}`）
- 忘记设置合并策略导致配置冲突
- 创建变量不写 description
- ✅ 用 agent_variable 管理敏感配置
- ✅ pnpm dlx 启动 stdio MCP（TS 模板统一）
- ✅ 测试每个 MCP 连接
