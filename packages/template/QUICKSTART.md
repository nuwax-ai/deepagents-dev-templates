# 快速入门 (QUICKSTART)

> 30 秒让 Agent 在你的终端跑起来。

## 前置要求

- Node.js ≥ 20
- 一个 LLM API key（Anthropic 或 OpenAI 均可）

## 30 秒上手

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key

```bash
cp .env.example .env
# 编辑 .env，至少设置一个:
#   ANTHROPIC_API_KEY=sk-ant-...
#   ANTHROPIC_AUTH_TOKEN=...
# 或
#   OPENAI_API_KEY=sk-...
#
# 可选:
#   ANTHROPIC_MODEL=claude-...
#   ANTHROPIC_BASE_URL=https://your-llm-proxy.example.com
```

### 3. 启动 REPL

```bash
bash scripts/run-repl.sh
```

或直接：

```bash
npx tsx src/index.ts chat
```

你应该看到：

```
╔════════════════════════════════════════╗
║   DeepAgents Interactive REPL          ║
╚════════════════════════════════════════╝
Agent: my-scenario-agent | Model: anthropic:claude-sonnet-4-6
Mode: local-only
Loaded 5 tools: http_request, json_utils, platform_api, agent_variable, mcp_tool_bridge

you>
```

### 4. 开始对话

```
you> 列出当前目录的所有 .ts 文件
...（Agent 会调用工具完成任务）
```

## 三种运行模式

| 模式 | 命令 | 用途 |
|------|------|------|
| **REPL** | `npx tsx src/index.ts chat` | 交互式对话 |
| **单次问答** | `npx tsx src/index.ts ask "你的问题"` | 一次性提问 |
| **文件执行** | `npx tsx src/index.ts run prompt.md` | 从文件读取 prompt |
| **ACP 服务器** | `npx tsx src/index.ts` | 给 nuwaclaw/Zed 客户端使用 |
| **节点关系图** | `npx tsx src/index.ts graph` | 给 nuwaclaw 页面展示生成代码结构 |

## 生成代码节点关系图

```bash
npm run graph
# 或写入文件
npx tsx src/index.ts graph .nuwaclaw-code-graph.json
```

输出 schema 是 `nuwaclaw.agent-code-graph.v1`，包含 runtime、tools、skills、prompts、config、distribution manifest 之间的节点和关系。

## REPL 内置命令

| 命令 | 说明 |
|------|------|
| `/help` | 显示帮助 |
| `/tools` | 列出可用工具 |
| `/config` | 显示当前配置 |
| `/clear` | 清屏 |
| `/save <path>` | 保存对话历史到 JSON 文件 |
| `/exit` 或 `/quit` | 退出 REPL |

## 启用平台集成（可选）

平台 API 提供变量管理、提示词保存、MCP 插件、workflow 执行和调试会话等功能。**完全可选** — 不配置也能正常运行 Agent（仅 `platform_api` 和 `agent_variable` 工具的部分操作不可用）。

### 配置平台凭据

```bash
# .env
PLATFORM_API_BASE_URL=https://api.nuwax.com
PLATFORM_API_TOKEN=<your-token>
PLATFORM_AGENT_ID=<your-agent-id>
PLATFORM_SPACE_ID=<your-space-id>
```

### 或通过配置文件

```json
// config/app-agent.config.json
{
  "platform": {
    "apiBaseUrl": "https://api.nuwax.com",
    "agentId": "your-agent-id",
    "spaceId": "your-space-id"
  }
}
```

配置平台凭据后，启动 ACP/CLI 时会自动读取该 Agent 已绑定的平台组件，并把 MCP 组件注入到运行时 MCP manager。默认合并优先级是：

```text
ACP_SESSION_CONFIG_JSON.mcpServers > 平台绑定 MCP 组件 > config/mcp.default.json
```

## 自定义配置

### 从 nuwaclaw/ACP 启动级注入配置

`deepagents-acp` 当前公开 API 还没有通用 per-session metadata hook。本模板支持通过启动环境变量注入 ACP/platform session 配置：

```bash
ACP_SESSION_CONFIG_JSON='{"model":"claude-sonnet-4-6","agentId":"agent-id","spaceId":"space-id","systemPrompt":"...","mcpServers":{"context7":{"command":"npx","args":["-y","@upstash/context7-mcp"]}}}' \
npx tsx src/index.ts
```

### 使用自定义配置文件

```bash
npx tsx src/index.ts chat --config /path/to/your-config.json
```

### 使用自定义系统提示词

```bash
npx tsx src/index.ts chat --prompt-file prompts/my-prompt.md
```

### 启用调试日志

```bash
npx tsx src/index.ts chat --debug
```

## 常见问题

**Q: 启动时报 "未设置 API key" 警告？**
A: 在 `.env` 中设置 `ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN` 或 `OPENAI_API_KEY`。

**Q: Agent 无法调用 LLM？**
A: 检查 API key 是否正确、网络是否可达。设置 `--debug` 查看详细日志。

**Q: `platform_api` 工具返回 "Platform API not available"？**
A: 这是预期行为 — 你运行在 `local-only` 模式。设置 `PLATFORM_AGENT_ID` 和 `PLATFORM_SPACE_ID` 启用平台功能。

**Q: REPL 启动后立即退出？**
A: 检查是否按到了 `Ctrl+D`。输入 `/exit` 退出。

**Q: 如何测试 ACP 模式？**
A: 使用 `npx tsx src/index.ts`（默认）启动 ACP server，然后用 Zed/JetBrains/nuwaclaw 客户端连接。

## 下一步

- 阅读 [README.md](./README.md) 了解完整架构
- 阅读 [PLAN.md](./PLAN.md) 了解设计决策
- 浏览 `prompts/` 目录修改或编写新提示词
- 浏览 `skills/` 目录添加自定义技能
- 浏览 `src/app/tools/` 添加自定义工具
- 查看 `tests/unit/` 学习如何扩展测试
