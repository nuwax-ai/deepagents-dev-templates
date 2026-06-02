---
name: mcp-setup
description: "配置 MCP 服务器、平台组件绑定、合并策略管理"
tags: [mcp, configuration, platform, integration]
version: "1.0.0"
---

# MCP 集成配置

## When to Use
需要添加 MCP 服务器、绑定平台组件、或调试 MCP 连接问题时使用。

## MCP 配置文件
默认配置：`config/mcp.default.json`

```json
{
  "servers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"],
      "description": "查询最新框架/API 文档"
    }
  }
}
```

## 添加新 MCP 服务器

### Stdio 类型（本地进程）
```json
{
  "my-server": {
    "command": "npx",
    "args": ["-y", "@my-org/mcp-server"],
    "env": {
      "API_KEY": "${AGENT_VAR_MY_API_KEY}"
    },
    "description": "服务器功能描述"
  }
}
```

### HTTP 类型（远程服务）
```json
{
  "remote-server": {
    "url": "https://mcp.example.com",
    "auth": {
      "type": "env",
      "var": "MCP_AUTH_TOKEN"
    },
    "description": "远程 MCP 服务"
  }
}
```

## 合并策略（session-wins）
MCP 配置按以下优先级合并（后者覆盖前者）：
1. `config/mcp.default.json` — 基础配置
2. 平台 MCP — 通过 `PlatformClient.listMcpServers()` 获取
3. ACP 会话覆盖 — 编辑器/客户端传入

配置在 `config/app-agent.config.json` 中：
```json
{
  "mcp": {
    "mergeStrategy": "session-wins"
  }
}
```

## 平台组件绑定
通过 `platform_api` 绑定平台提供的组件：
```json
platform_api(operation: "bind_component", params: {
  "componentId": "<组件ID>",
  "config": { ... }
})
```

组件类型：
- 知识库（knowledge base）
- 表单构建器（form builder）
- 工作流触发器（workflow trigger）

## 环境变量插值
MCP 配置中支持 `${AGENT_VAR_XXX}` 占位符：
- 运行时自动替换为 agent variable 的值
- 用于 API key、token 等敏感配置
- 变量不存在时工具调用会报错

## 调试 MCP 问题
1. 检查服务器列表：`mcp_tool_bridge(operation: "list_servers")`
2. 测试工具调用：`mcp_tool_bridge(operation: "call_tool", ...)`
3. 查看日志：stderr 中搜索 `mcp` 关键词
4. 验证环境变量：确认 `AGENT_VAR_*` 已设置

## 常见问题
| 问题 | 原因 | 解决 |
|------|------|------|
| Server not found | 未在配置中添加 | 添加到 mcp.default.json 或平台 |
| Auth failed | 缺少环境变量 | 创建 agent_variable 存储 token |
| Timeout | 服务器响应慢 | 增加超时或检查服务器健康 |
| Tool not found | 工具名错误 | 先 list_servers 再 call_tool |

## Anti-patterns
- ❌ 直接在 env 中硬编码 API key（用 `${AGENT_VAR_XXX}`）
- ❌ 忘记设置合并策略导致配置冲突
- ❌ 不测试就假设 MCP 服务器正常
- ✅ 使用 agent_variable 管理敏感配置
- ✅ 测试每个 MCP 服务器的连接
- ✅ 记录 MCP 配置变更原因
