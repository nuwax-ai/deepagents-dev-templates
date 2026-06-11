---
name: deepagents-acp-py
description: "Python 模板 ACP 协议集成参考:官方 deepagents-acp AgentServerACP、会话配置、平台身份、调试方法"
tags: [acp, deepagents, langgraph, session, platform, protocol, python]
version: "2.0.0"
---

# ACP 协议集成参考(Python 模板)

## When to Use

需要理解或配置 Python 模板的 ACP 服务器时使用——包括 `bootstrap()` 启动、官方 `deepagents-acp`、`ACP_SESSION_CONFIG_JSON`、平台身份、会话优先级链。

---

## 核心:ACP Server(官方 deepagents-acp)

Python 模板的 ACP server 在 `src/deepagents_app_py/surfaces/acp/`,直接使用 **官方 `deepagents-acp`(PyPI)** 的 `AgentServerACP`(与 TS 模板用 `deepagents-acp` npm 包对齐)。**不再有自研的 stdio 循环。**

```python
# src/deepagents_app_py/surfaces/acp/server.py
from acp import run_agent
from deepagents_app_py.surfaces.acp.session_lifecycle import DeepAgentsAppServer  # AgentServerACP 子类

# bootstrap() 流程:
# 1. loadConfig() — 6 层优先级配置
# 2. load_session_config_from_env() — 解析 ACP_SESSION_CONFIG_JSON
# 3. build_acp_agent_factory() — 返回工厂 (AgentSessionContext) -> CompiledStateGraph
# 4. DeepAgentsAppServer(agent=factory, models=...) + await run_agent(server)
```

**工厂模式**:`build_acp_agent_factory()` 返回的工厂被官方 server 调用,内部 `create_deep_agent(**build_agent_config_parts(...))` 构图;工厂吃 `ctx.model` 实现**模型切换**。

**官方 server 已内置**:LangGraph 流式输出、HITL 权限提示(approve/reject/edit)、模型/模式切换、todo/计划更新、多模态输入。

**`DeepAgentsAppServer` 补丁**(`session_lifecycle.py`):补官方 0.0.8 缺的 server name/version(`initialize().agent_info`)。**仍待补**(已在文件中标注 deferred):slash 命令拦截、ACP `mcp_servers` 转发。

**重要**:`surfaces/acp/` 在保护区,开发者不需要修改。

### 与 TS 模板的差异(已基本对齐)

| | TS 模板 | Python 模板 |
|---|---------|------------|
| **ACP 库** | `deepagents-acp`(npm) | `deepagents-acp`(PyPI,`AgentServerACP`) |
| **底层 SDK** | `@agentclientprotocol/sdk` | `agent-client-protocol`(`acp`) |
| **入口类** | `DeepAgentsServer` | `AgentServerACP` → 子类 `DeepAgentsAppServer` |
| **Agent** | `createDeepAgent()` 配置 | 工厂返回 `create_deep_agent()` 图 |
| **流式/HITL** | 库内置 | 库内置(LangGraph `astream`) |

---

## ACPSessionConfig(最高优先级覆盖)

ACP 客户端(如 nuwaclaw/Zed)在建立连接时传入会话级配置,通过环境变量传入:

```bash
ACP_SESSION_CONFIG_JSON='{"model":"anthropic:claude-opus-4-8","cwd":"/workspace/my-project"}' \
  uv run deepagents-app-py
```

字段:`model`(`provider:name`)、`system_prompt`、`cwd`、`agent_id`、`space_id`、`mcp_servers`。

---

## 配置优先级链(6 层,从低到高)

```
defaults
  < user ~/.deepagents/config.json
  < project .deepagents/config.json
  < config/app-agent.config.json
  < 环境变量(ANTHROPIC_API_KEY、LLM_PROVIDER 等)
  < ACP_SESSION_CONFIG_JSON(最高优先级)
```

---

## 平台身份配置

```bash
PLATFORM_AGENT_ID=2843
PLATFORM_SPACE_ID=1136
PLATFORM_API_TOKEN=your-token-here
```

未配置时自动切换到 local-only 模式。

---

## ACP 调试

```bash
# 前提:uv sync --group dev
pnpm dlx rcoder-cli chat -c "uv run deepagents-app-py" -w . -p "hello" --timeout 30 --mode yolo -q
pnpm dlx rcoder-cli tui  -c "uv run deepagents-app-py" -w .          # 交互式
pnpm dlx rcoder-cli chat -c "uv run deepagents-app-py" -w . -p "hi" -vv   # 详细日志
```

直接看启动报错:`uv run deepagents-app-py`(日志走 stderr,stdout 留给 ACP JSON-RPC)。

---

## ACP 服务器文件结构(仅供参考,禁止修改)

```
src/deepagents_app_py/surfaces/acp/
├── __init__.py
├── server.py                # bootstrap():build factory → AgentServerACP → run_agent
├── config_builder.py        # build_acp_agent_factory() + load_session_config_from_env()
├── session_lifecycle.py     # DeepAgentsAppServer(AgentServerACP):补 name/version
├── session_manager.py       # 会话追踪(占位)
└── slash_command_handler.py # /命令处理(占位,deferred)
```

---

## 常见错误排查

| 错误 | 原因 | 解决 |
|------|------|------|
| 模型调用 401/无 key | 缺 API key | 填 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` |
| `Failed to start subprocess` | agent 启动崩溃 | `uv run deepagents-app-py` 直接看报错 |
| `Please remove duplicate middleware` | 自加了 deepagents 已内置的中间件(如 Summarization) | 删掉,复用内置 |
| `platform_api` 返回 "not configured" | 缺平台身份 | 设 `PLATFORM_API_URL` / `PLATFORM_API_TOKEN` |
| ACP timeout | 握手无响应 | 加 `-vv` 看日志 |

## Anti-patterns

- ❌ 修改 `src/deepagents_app_py/surfaces/` 或 `runtime/`
- ❌ 在运行时代码中硬编码系统提示词(从 ACP 会话/配置获取)
- ❌ 把 API token 写死在代码里
- ❌ 重新手写 ACP stdio 循环(用官方 `deepagents-acp`)
- ✅ 用 `pnpm dlx rcoder-cli chat` 快速验证
- ✅ 生产密钥通过 `agent_variable` 管理
