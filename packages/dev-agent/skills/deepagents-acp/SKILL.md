---
name: deepagents-acp
description: "deepagents-acp 协议集成参考：DeepAgentsServer、ACPSessionConfig、平台身份配置、会话生命周期、调试方法"
tags: [acp, deepagents-acp, session, platform, protocol]
version: "1.0.0"
---

# deepagents-acp 协议集成参考

## When to Use

需要理解或配置 ACP（Agent Client Protocol）服务器时使用——包括 `DeepAgentsServer` 的启动方式、`ACPSessionConfig` 结构、平台身份配置、会话配置优先级、以及 ACP 连接调试。

---

## 核心：DeepAgentsServer

`deepagents-acp` 包提供 `DeepAgentsServer`，将 deepagents 的 `createDeepAgent()` agent 包装成 stdio 协议的 ACP 服务器：

```typescript
import { DeepAgentsServer, type DeepAgentConfig } from "deepagents-acp";

const server = new DeepAgentsServer({
  // DeepAgentConfig：与 createDeepAgent() 的参数相同
  agents: {
    name: "my-agent",
    systemPrompt: "...",
    tools: [...tools],
    checkpointer: checkpointer,
    // ... 其他字段
  } satisfies DeepAgentConfig,
});

await server.start();
```

**重要**：模板中 `DeepAgentsServer` 在 `src/surfaces/acp/server.ts` 中启动，开发者不需要修改这个文件。

---

## ACPSessionConfig（高优先级覆盖）

ACP 客户端（如 nuwaclaw 编辑器）在建立连接时传入会话级配置。这是优先级最高的配置层。

```typescript
interface ACPSessionConfig {
  model?: string;                    // 覆盖 config.model.name
  systemPrompt?: string;             // 覆盖 config.agent.systemPromptPath 加载的内容
  cwd?: string;                      // 工作目录（项目根目录）
  agentId?: string;                  // 平台 Agent ID（覆盖 PLATFORM_AGENT_ID）
  spaceId?: string;                  // 平台 Space ID（覆盖 PLATFORM_SPACE_ID）
  mcpServers?: Record<string, unknown>; // 追加/覆盖 MCP 服务器配置
}
```

通过环境变量传入（nuwaclaw 平台在启动时自动注入）：

```bash
ACP_SESSION_CONFIG_JSON='{"model":"claude-opus-4-8","cwd":"/workspace/my-project"}' \
  node dist/bundle.mjs
```

---

## 配置优先级链（从低到高）

```
defaults
  < user ~/.deepagents/config.json
  < project .deepagents/config.json
  < config/app-agent.config.json
  < 环境变量（ANTHROPIC_API_KEY、LLM_PROVIDER 等）
  < ACP_SESSION_CONFIG_JSON（最高优先级）
```

**实践意义**：
- 提示词在平台 UI 中修改后，通过 `ACP_SESSION_CONFIG_JSON.systemPrompt` 传入 → 无需改代码
- 模型选择在平台 UI 配置 → 通过 `model` 字段覆盖
- MCP 服务器追加 → 通过 `mcpServers` 字段追加（受 mergeStrategy 控制）

---

## 平台身份配置

平台工具（`platform_api`、`agent_variable`）需要 Agent ID 和 Space ID：

```bash
# .env 文件（本地开发）
PLATFORM_AGENT_ID=2843
PLATFORM_SPACE_ID=1136
PLATFORM_API_TOKEN=your-token-here
```

或通过 ACP session 配置（平台运行时）：

```json
{
  "agentId": "2843",
  "spaceId": "1136"
}
```

未配置时，`PlatformClient` 为 `null`，模板自动切换到 local-only 模式（`platform_api` 和 `agent_variable` 工具返回错误提示）。

---

## MCP 合并策略

```json
// config/app-agent.config.json
{
  "mcp": {
    "configPath": "./config/mcp.default.json",
    "mergeStrategy": "session-wins"
  }
}
```

| 策略 | 行为 |
|------|------|
| `session-wins` | ACP session 的 mcpServers 覆盖默认和平台配置 |
| `platform-wins` | 平台绑定的 MCP 服务器覆盖 session 配置 |
| `defaults-wins` | config/mcp.default.json 优先，session 不可覆盖 |

---

## 提示词保存（save_prompt）

修改提示词后必须通过 `platform_api` 保存到平台，否则下次 ACP 启动时仍会加载旧提示词：

```typescript
// 在 agent 对话中调用：
platform_api(operation: "save_prompt", params: {
  "prompt": "<新的系统提示词内容>",
  "metadata": {
    "version": "1.1.0",
    "scenario": "code-assistant"
  }
})
```

---

## ACP 调试

### 快速冒烟测试

```bash
# 前提：pnpm run build 已执行
pnpm dlx rcoder-cli chat \
  -c "node dist/bundle.mjs" \
  -w . \
  -p "hello" \
  --timeout 30 \
  --mode yolo \
  -q

# 或简写：
pnpm run smoke:acp
```

### 交互式调试

```bash
pnpm dlx rcoder-cli tui -c "node dist/bundle.mjs" -w .
```

### 详细日志

```bash
pnpm dlx rcoder-cli chat -c "node dist/bundle.mjs" -w . -p "hello" -vv
```

---

## 常见错误排查

| 错误 | 原因 | 解决 |
|------|------|------|
| `model_provider is None` | `.env` 缺少 API key | 填写 `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY` |
| `Failed to start subprocess` | agent 启动崩溃 | `node dist/bundle.mjs` 直接看原始报错 |
| `platform_api` 返回 "not configured" | 缺少平台身份 | 设置 `PLATFORM_AGENT_ID` 和 `PLATFORM_SPACE_ID` |
| MCP server not found | 配置路径错误或 pnpm 缓存问题 | `pnpm dlx <mcp-package>` 手动测试 |
| 提示词不生效 | 未调用 `save_prompt` 保存 | 对话中调用 `platform_api(save_prompt)` |
| ACP timeout | 握手无响应 | 加 `-vv` 查看详细日志 |

---

## ACP 服务器文件结构（仅供参考，禁止修改）

```
src/surfaces/acp/
├── server.ts              # DeepAgentsServer 启动入口
├── config-builder.ts      # 构建 DeepAgentConfig
├── session-manager.ts     # ACP 会话生命周期管理
├── session-lifecycle.ts   # 会话状态机
└── slash-command-handler.ts  # /命令处理
```

这些文件在**保护区**内，开发者不可修改。

---

## Anti-patterns

- ❌ 修改 `src/surfaces/acp/` 或 `src/runtime/` 中的文件
- ❌ 在运行时代码中硬编码系统提示词（通过 ACP session 或文件加载）
- ❌ 把 API token 写死在代码里（通过 `PLATFORM_API_TOKEN` env 注入）
- ❌ 修改提示词后不调用 `save_prompt`（重启后丢失）
- ❌ 使用 `require()` 导入（必须用 ES modules `import`）
- ✅ 用 `pnpm run smoke:acp` 快速验证改动不破坏 ACP 协议
- ✅ 提示词修改 → 立即 `save_prompt` → 验证效果
- ✅ 生产密钥通过 `agent_variable` 管理，不放在 `.env`