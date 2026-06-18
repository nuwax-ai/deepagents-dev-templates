---
name: flow-tools-config
description: "deepagents-flow-ts 目标模板项目的工具开发与配置管理：在 src/libs/tools/ 用 tool() + Zod schema 创建工具，并在 src/app/flow-tools.ts 注册到 createFlowTools()；MCP 服务器配置（stdio/http）、合并策略、agent_variable 密钥管理。工具优先级：平台→内置→MCP→自写"
tags: [tools, mcp, variables, secrets, configuration, zod, deepagents-flow-ts]
version: "1.0.0"
---

# 工具开发与配置（deepagents-flow-ts）

## When to Use
需要添加自定义工具、配置 MCP 服务器、管理 API key / 变量时。

## 工具创建

### 前置检查（强制优先级）
```
1. 平台 Plugin / Workflow / Knowledge  ← 先加载 agent-dev-config 搜索并添加配置
2. 内置工具：bash/fs/search/demo/http_request/json_utils/platform_api/agent_variable/mcp_tool_bridge
3. native MCP 工具：ctx.mcpTools（@langchain/mcp-adapters 自动加载）
4. 以上都没有 → 在 src/libs/tools/ 创建自定义工具，并在 src/app/flow-tools.ts 注册
```

### 创建工具文件 `src/libs/tools/{name}.tool.ts`

**无状态工具（不需要平台依赖）：**
```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const weatherTool = tool(
  async ({ city }) => {
    const apiKey = process.env.AGENT_VAR_WEATHER_API_KEY;
    if (!apiKey) return "错误：请填写 WEATHER_API_KEY";
    const res = await fetch(`https://api.weather.com/v1?city=${city}&key=${apiKey}`);
    const data = await res.json() as { temp: number };
    return `${city}: ${data.temp}°C`;
  },
  {
    name: "get_weather",
    description: "获取城市天气",
    schema: z.object({
      city: z.string().describe("城市名称"),
    }),
  }
);
```

**平台绑定工具（需 RuntimeContext）→ 工厂模式：**
```typescript
import type { RuntimeContext } from "../../src/runtime/index.js";

export function createMyTool(ctx: RuntimeContext) {
  return tool(
    async ({ query }) => {
      const apiKey = await ctx.variableManager.get("MY_API_KEY");
      if (!apiKey) return "错误：请填写 MY_API_KEY";
      if (ctx.platformClient) {
        const result = await ctx.platformClient.executePlugin("my-plugin", { query });
        return JSON.stringify(result);
      }
      return `Query: ${query}`;
    },
    { name: "my_tool", description: "...", schema: z.object({ query: z.string() }) }
  );
}
```

### Zod Schema 规范
- 每个字段加 `.describe()`（LLM 依赖描述正确填参）
- 必填不加 `.optional()`，非必填加 `.optional()` 或 `.default()`
- 类型映射：`string`→`z.string()`、`integer/number`→`z.number()`、`boolean`→`z.boolean()`
- `tool()` 必须返回 string，复杂对象用 `JSON.stringify()`

### 注册到 createFlowTools()
```typescript
// src/libs/tools/index.ts
import { weatherTool } from "./weather.tool.js";
import { createMyTool } from "./my-service.tool.js";

// src/app/flow-tools.ts
// 在 reused 或 buildTools 返回数组中加入：
weatherTool,        // 无状态：直接引用
createMyTool(ctx),  // 平台绑定：工厂调用
```
注册后 think 节点自动 `bindTools(allTools)`，无需手动绑定。

---

## MCP 服务器配置

默认配置：`config/mcp.default.json`

**Stdio 类型：**
```json
{
  "my-server": {
    "command": "pnpm",
    "args": ["dlx", "my-mcp-package"],
    "env": { "API_KEY": "${AGENT_VAR_MY_API_KEY}" },
    "description": "服务器功能"
  }
}
```

**HTTP 类型：**
```json
{
  "remote-server": {
    "url": "https://mcp.example.com",
    "auth": { "type": "env", "var": "MCP_AUTH_TOKEN" },
    "description": "远程 MCP"
  }
}
```

### 合并策略（config/flow-agent.config.json）
```json
{ "mcp": { "configPath": "./config/mcp.default.json", "mergeStrategy": "session-wins" } }
```
| 策略 | 行为 |
|------|------|
| `session-wins` | ACP session 的 mcpServers 覆盖默认和平台配置（默认） |
| `platform-wins` | 平台绑定的 MCP 覆盖 session |
| `defaults-wins` | config/mcp.default.json 优先 |

### 在节点里直接调 MCP
```typescript
import { callMcpTool } from "../mcp-client.js";
const result = await callMcpTool(
  { command: "npx", args: ["-y", "duckduckgo-mcp-server"] },
  "duckduckgo_search", { query }, 20000
);
```

### 调试 MCP
- `pnpm exec tsx src/index.ts capabilities`（列 MCP 服务器）
- `mcp_tool_bridge(operation: "list_servers")`
- stderr 搜 `mcp` 看日志

---

## 变量管理（agent_variable）

### 核心原则
- **永远不要硬编码密钥** — 所有敏感值通过变量管理
- **AI 创建占位，用户填写值** — 变量创建后初始值为空
- **统一命名** — UPPER_SNAKE_CASE

### 创建变量
```json
agent_variable(operation: "create", params: {
  "name": "WEATHER_API_KEY",
  "type": "secret",
  "description": "天气 API key，从 https://weather.com 获取"
})
```

| 类型 | 用途 | 示例 |
|------|------|------|
| `secret` | API key、token、密码 | `MY_API_KEY` |
| `string` | 普通配置值 | `DEFAULT_LANGUAGE` |
| `number` | 数值配置 | `MAX_RETRIES` |
| `boolean` | 开关配置 | `ENABLE_LOGGING` |

### 读取方式
```typescript
// 方式 1：RuntimeContext（推荐，平台绑定工具）
const apiKey = await ctx.variableManager.get("WEATHER_API_KEY");
// 方式 2：环境变量（无状态工具 / 图节点）
const apiKey = process.env.AGENT_VAR_WEATHER_API_KEY;
```

### MCP 配置中的变量插值
```json
{ "env": { "API_KEY": "${AGENT_VAR_WEATHER_API_KEY}" } }
```

---

## Anti-patterns
- ❌ 不查平台/内置/MCP 就写自定义工具
- ❌ 在工具代码中硬编码 API key
- ❌ 使用 `any` 类型
- ❌ 不给 Zod 字段加 `.describe()`
- ❌ 忘记在 createFlowTools() 的 buildTools() 中注册新工具
- ❌ 忘记设置 MCP 合并策略导致配置冲突
- ✅ 先查平台 + 内置 + MCP，确认无方案再写
- ✅ 用 agent_variable 管理密钥（UPPER_SNAKE_CASE）
- ✅ 注册到 createFlowTools() 数组
- ✅ pnpm dlx 启动 stdio MCP（TS 模板统一）
