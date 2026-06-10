---
name: variable-setup
description: "设计和创建 agent variable：API key 管理、命名规范、变量类型（TS / Python 通用）"
tags: [variables, secrets, configuration, platform]
version: "2.0.0"
---

# 变量管理

## When to Use
工具需要外部 API key、token 或配置值时，必须通过 agent_variable 管理。

## 通用概念

### 核心原则
- 🔑 **永远不要硬编码密钥** — 所有敏感值必须通过变量管理
- 📝 **AI 创建占位，用户填写值** — 变量创建后初始值为空
- 🏷️ **命名规范** — 使用统一的命名约定

### 创建变量

```json
agent_variable(operation: "create", params: {
  "name": "WEATHER_API_KEY",
  "type": "secret",
  "description": "天气服务 API key，从 https://weather.com 获取"
})
```

### 变量类型
| 类型 | 用途 | 示例 |
|------|------|------|
| `secret` | API key、token、密码 | `MY_API_KEY` |
| `string` | 普通配置值 | `DEFAULT_LANGUAGE` |
| `number` | 数值配置 | `MAX_RETRIES` |
| `boolean` | 开关配置 | `ENABLE_LOGGING` |

### 命名规范
- **格式**：`UPPER_SNAKE_CASE`
- **前缀规则**：
  - 平台相关：`PLATFORM_XXX`
  - 第三方 API：`{SERVICE}_API_KEY`
  - Agent 配置：`AGENT_XXX`
  - MCP 相关：`MCP_XXX`

### 变量生命周期
1. **创建** — AI 通过 `agent_variable(operation: "create")` 创建
2. **填写** — 用户在平台 UI 中填写实际值
3. **使用** — 工具代码中读取（方式见下方 TS/Python 区分）
4. **更新** — 用户可随时在平台 UI 更新值
5. **列表** — `agent_variable(operation: "list")` 查看所有变量

### 读取和更新
```json
// 读取
agent_variable(operation: "get", params: { "name": "WEATHER_API_KEY" })

// 更新
agent_variable(operation: "set", params: {
  "name": "WEATHER_API_KEY",
  "value": "new-value"
})

// 列出所有变量
agent_variable(operation: "list")
```

### MCP 配置中的变量插值（通用）

```json
{
  "env": {
    "API_KEY": "${AGENT_VAR_WEATHER_API_KEY}"
  }
}
```

---

## TypeScript 模板

在工具中读取变量：

```typescript
// 方式 1：通过 ToolContext（推荐）
export function createMyTool(ctx: ToolContext) {
  return tool(
    async ({ query }) => {
      const apiKey = await ctx.variableManager.get("WEATHER_API_KEY");
      if (!apiKey) {
        return "错误：请先在平台设置中填写 WEATHER_API_KEY";
      }
    },
    { /* ... */ }
  );
}

// 方式 2：直接通过环境变量
const apiKey = process.env.AGENT_VAR_WEATHER_API_KEY;
```

MCP 服务器使用 `pnpm dlx`：
```json
{
  "weather-mcp": {
    "command": "pnpm",
    "args": ["dlx", "@weather/mcp-server"],
    "env": {
      "API_KEY": "${AGENT_VAR_WEATHER_API_KEY}"
    }
  }
}
```

## Python 模板

在工具中读取变量：

```python
import os

# 通过环境变量读取
api_key = os.environ.get("AGENT_VAR_WEATHER_API_KEY")
if not api_key:
    return "错误：请先在平台设置中填写 WEATHER_API_KEY"
```

MCP 服务器使用 `uvx`：
```json
{
  "weather-mcp": {
    "command": "uvx",
    "args": ["weather-mcp-server"],
    "env": {
      "API_KEY": "${AGENT_VAR_WEATHER_API_KEY}"
    }
  }
}
```

---

## 变量设计清单

创建新工具时：
- [ ] 列出工具需要的所有外部凭据
- [ ] 为每个凭据创建 agent_variable
- [ ] 命名遵循 UPPER_SNAKE_CASE 规范
- [ ] 在 description 中说明如何获取该值
- [ ] 工具代码中有变量缺失时的错误提示
- [ ] 不在代码中硬编码任何密钥

## Anti-patterns
- ❌ 在代码中写 `const apiKey = "sk-xxx123"` 或 `api_key = "sk-xxx123"`
- ❌ 在 .env 文件中写死生产环境的 key
- ❌ 变量名用驼峰或随机命名
- ❌ 创建变量不写 description
- ✅ 用 agent_variable 创建，用户在 UI 填写
- ✅ 命名用 UPPER_SNAKE_CASE
- ✅ description 说明获取方式和用途
