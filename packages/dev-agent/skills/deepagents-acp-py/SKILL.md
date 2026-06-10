---
name: deepagents-acp-py
description: "Python 模板 ACP 协议集成参考：stdio server、会话配置、平台身份、调试方法"
tags: [acp, pydantic-ai, session, platform, protocol, python]
version: "1.1.0"
---

# ACP 协议集成参考（Python 模板）

## When to Use

需要理解或配置 Python 模板的 ACP 服务器时使用——包括 `bootstrap()` 启动、`ACPSessionConfig`、平台身份配置、会话优先级链。

---

## 核心：ACP Server

Python 模板的 ACP server 在 `src/deepagents_app_py/surfaces/acp/` 中，通过 **stdio transport** 与宿主进程通信。

```python
# src/deepagents_app_py/surfaces/acp/server.py
from deepagents_app_py.surfaces.acp.server import bootstrap

# ACP 启动流程：
# 1. loadConfig() — 加载 6 层优先级配置
# 2. 解析 ACP_SESSION_CONFIG_JSON 环境变量
# 3. buildACPAgentConfig() — 组装 Agent 配置
# 4. 进入 stdin JSON-line 循环（读请求 → 写响应）
```

**重要**：`surfaces/acp/` 在保护区，开发者不需要修改。

### 与 TS 模板的差异

| | TS 模板 | Python 模板 |
|---|---------|------------|
| **ACP 库** | `deepagents-acp`（npm） | `agent-client-protocol`（PyPI，可选依赖） |
| **底层 SDK** | `@agentclientprotocol/sdk ^0.18.0` | 无（手写 stdio JSON-line 循环） |
| **协议实现** | SDK 提供完整 ACP 协议支持 | **裸实现**：手动读 stdin、写 stdout |
| **成熟度** | 完整 ACP handshake / notification / tool call | 基础 request-response，尚未接入 SDK |

**当前状态**：`agent-client-protocol>=0.8.0` 已声明在 `pyproject.toml` 的 `[acp]` optional dependency 中，但 `src/` 中 **没有 import 过**。ACP server 是自己手写的简化版 stdio 循环，未使用 SDK 提供的协议解析能力。

**影响**：
- 基本 ACP 功能（启动、接收消息、返回响应）可用
- 高级 ACP 特性（notification、tool call streaming、capability negotiation）可能不完整
- 后续计划接入 `agent-client-protocol` SDK 以对齐 TS 模板的完整 ACP 支持

---

## ACPSessionConfig（最高优先级覆盖）

ACP 客户端（如 nuwaclaw/Zed）在建立连接时传入会话级配置：

```python
# Pydantic 模型
class ACPSessionConfig(_CamelModel):
    model: str | None                        # 覆盖 config.model.name
    system_prompt: str | None                # 覆盖系统提示词
    cwd: str | None                          # 工作目录
    agent_id: str | None                     # 平台 Agent ID
    space_id: str | None                     # 平台 Space ID
    mcp_servers: dict[str, Any] | None       # 追加/覆盖 MCP 服务器配置
```

通过环境变量传入：

```bash
ACP_SESSION_CONFIG_JSON='{"model":"claude-opus-4-8","cwd":"/workspace/my-project"}' \
  uv run deepagents-app-py
```

---

## 配置优先级链（6 层，从低到高）

```
defaults
  < user ~/.deepagents/config.json
  < project .deepagents/config.json
  < config/app-agent.config.json
  < 环境变量（ANTHROPIC_API_KEY、LLM_PROVIDER 等）
  < ACP_SESSION_CONFIG_JSON（最高优先级）
```

---

## 平台身份配置

```json
// config/platform.json
{
  "platformApiBaseUrl": "https://api.nuwax.ai",
  "agentId": "2843",
  "spaceId": "1136"
}
```

或通过环境变量：

```bash
PLATFORM_AGENT_ID=2843
PLATFORM_SPACE_ID=1136
PLATFORM_API_TOKEN=your-token-here
```

未配置时自动切换到 local-only 模式。

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

## ACP 调试

### 快速冒烟测试

```bash
# 前提：uv sync --group dev 已执行
pnpm dlx rcoder-cli chat \
  -c "uv run deepagents-app-py" \
  -w . \
  -p "hello" \
  --timeout 30 \
  --mode yolo \
  -q
```

### 交互式调试

```bash
pnpm dlx rcoder-cli tui -c "uv run deepagents-app-py" -w .
```

### 详细日志

```bash
pnpm dlx rcoder-cli chat -c "uv run deepagents-app-py" -w . -p "hello" -vv
```

---

## ACP 服务器文件结构（仅供参考，禁止修改）

```
src/deepagents_app_py/surfaces/acp/
├── __init__.py                  # 导出 bootstrap()
├── server.py                    # ACP stdio 服务器入口
├── config_builder.py            # 构建 Agent 配置
├── session_manager.py           # 会话追踪
├── session_lifecycle.py         # 会话状态管理
└── slash_command_handler.py     # /命令处理
```

---

## 常见错误排查

| 错误 | 原因 | 解决 |
|------|------|------|
| `model_provider is None` | `.env` 缺少 API key | 填写 `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY` |
| `Failed to start subprocess` | agent 启动崩溃 | `uv run deepagents-app-py` 直接看报错 |
| `platform_api` 返回 "not configured" | 缺少平台身份 | 设置 `PLATFORM_AGENT_ID` 和 `PLATFORM_SPACE_ID` |
| MCP server not found | 配置路径错误 | `uvx <mcp-package>` 手动测试 |
| 提示词不生效 | 未调用 `save_prompt` | 对话中调用 `platform_api(save_prompt)` |
| ACP timeout | 握手无响应 | 加 `-vv` 查看详细日志 |

## Anti-patterns

- ❌ 修改 `src/deepagents_app_py/surfaces/` 或 `src/deepagents_app_py/runtime/`
- ❌ 在运行时代码中硬编码系统提示词
- ❌ 把 API token 写死在代码里
- ❌ 修改提示词后不调用 `save_prompt`
- ✅ 用 `pnpm dlx rcoder-cli chat` 快速验证 ACP 协议
- ✅ 提示词修改 → 立即 `save_prompt` → 验证效果
- ✅ 生产密钥通过 `agent_variable` 管理
