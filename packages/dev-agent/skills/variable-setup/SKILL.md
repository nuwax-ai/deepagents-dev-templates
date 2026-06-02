---
name: variable-setup
description: "设计和创建 agent variable：API key 管理、命名规范、变量类型"
tags: [variables, secrets, configuration, platform]
version: "1.0.0"
---

# 变量管理

## When to Use
工具需要外部 API key、token 或配置值时，必须通过 agent_variable 管理。

## 核心原则
- 🔑 **永远不要硬编码密钥** — 所有敏感值必须通过变量管理
- 📝 **AI 创建占位，用户填写值** — 变量创建后初始值为空
- 🏷️ **命名规范** — 使用统一的命名约定

## 创建变量

### 基本创建
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

## 命名规范
- **格式**：`UPPER_SNAKE_CASE`
- **前缀规则**：
  - 平台相关：`PLATFORM_XXX`
  - 第三方 API：`{SERVICE}_API_KEY`（如 `WEATHER_API_KEY`）
  - Agent 配置：`AGENT_XXX`
  - MCP 相关：`MCP_XXX`
- **示例**：
  - `WEATHER_API_KEY` — 天气 API 密钥
  - `EMAIL_SMTP_PASSWORD` — 邮件 SMTP 密码
  - `DEFAULT_LANGUAGE` — 默认语言配置
  - `MAX_RETRIES` — 最大重试次数

## 在工具中使用变量

**推荐方式（通过 ToolContext）：**
```typescript
// 在平台绑定工具中（工厂函数接收 ctx）
export function createMyTool(ctx: ToolContext) {
  return tool(
    async ({ query }) => {
      const apiKey = await ctx.variableManager.get("WEATHER_API_KEY");
      if (!apiKey) {
        return "错误：请先在平台设置中填写 WEATHER_API_KEY";
      }
      // 使用 apiKey 调用外部服务
    },
    { /* ... */ }
  );
}
```

**MCP 配置中的变量插值：**
```json
{
  "env": {
    "API_KEY": "${AGENT_VAR_WEATHER_API_KEY}"
  }
}
```
MCP 服务器配置中的 `${AGENT_VAR_XXX}` 会在运行时自动替换。

## 变量生命周期
1. **创建** — AI 通过 `agent_variable(operation: "create")` 创建
2. **填写** — 用户在平台 UI 中填写实际值
3. **使用** — 工具通过 `process.env.AGENT_VAR_XXX` 读取
4. **更新** — 用户可随时在平台 UI 更新值
5. **列表** — `agent_variable(operation: "list")` 查看所有变量

## 读取和更新
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

## 在 MCP 配置中使用
```json
{
  "weather-mcp": {
    "command": "npx",
    "args": ["-y", "@weather/mcp-server"],
    "env": {
      "API_KEY": "${AGENT_VAR_WEATHER_API_KEY}"
    }
  }
}
```

## 变量设计清单
创建新工具时：
- [ ] 列出工具需要的所有外部凭据
- [ ] 为每个凭据创建 agent_variable
- [ ] 命名遵循 UPPER_SNAKE_CASE 规范
- [ ] 在 description 中说明如何获取该值
- [ ] 工具代码中有变量缺失时的错误提示
- [ ] 不在代码中硬编码任何密钥

## Anti-patterns
- ❌ 在代码中写 `const apiKey = "sk-xxx123"`
- ❌ 在 .env 文件中写死生产环境的 key
- ❌ 变量名用驼峰或随机命名
- ❌ 创建变量不写 description
- ✅ 用 agent_variable 创建，用户在 UI 填写
- ✅ 命名用 UPPER_SNAKE_CASE
- ✅ description 说明获取方式和用途
