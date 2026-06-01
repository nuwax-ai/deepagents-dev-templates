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
# 或
#   OPENAI_API_KEY=sk-...
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

平台 API 提供变量管理、提示词保存、MCP 插件等功能。**完全可选** — 不配置也能正常运行 Agent（仅 `platform_api` 和 `agent_variable` 工具的部分操作不可用）。

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

## 自定义配置

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
A: 在 `.env` 中设置 `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY`。

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
