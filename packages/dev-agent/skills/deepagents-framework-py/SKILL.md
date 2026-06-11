---
name: deepagents-framework-py
description: "LangGraph + deepagents 框架核心 API 参考:create_deep_agent、模型解析、langchain 工具、AgentMiddleware 中间件链、ACP 服务(Python 模板专用)"
tags: [deepagents, langgraph, langchain, framework, api, tools, config, python]
version: "2.0.0"
---

# LangGraph + deepagents 框架参考(Python 模板)

## When to Use

需要理解或扩展 Python 模板的 **LangGraph + deepagents** 框架时使用——Agent 构建、模型解析、langchain 工具、`AgentMiddleware` 中间件链、ACP 服务、配置结构。

---

## 核心架构

Python 模板基于 **LangGraph + 官方 `deepagents`**(与 TS 模板对齐,**不再用 pydantic-ai**)。关键对应关系:

| TS 模板 | Python 模板 |
|---------|------------|
| `deepagents` (npm) `createDeepAgent()` | `deepagents` (PyPI) `create_deep_agent()` |
| `@langchain/langgraph` | `langgraph` |
| `@langchain/anthropic` / `@langchain/openai` | `langchain-anthropic` / `langchain-openai` / `langchain-google-genai` |
| `deepagents-acp` `DeepAgentsServer` | `deepagents-acp` `AgentServerACP`(`deepagents_acp.server`)|
| `AgentMiddleware` (langchain) | `langchain.agents.middleware.AgentMiddleware` |
| `MemorySaver` | `langgraph.checkpoint.memory.MemorySaver` |

`create_deep_agent(...)` 返回一个已编译的 LangGraph `CompiledStateGraph`,自带 filesystem / todo / skills / subagent / memory / 摘要压缩 / HITL 等内置中间件。

---

## 依赖生态

| 包名 | 用途 |
|------|------|
| `deepagents` | 核心 deep-agent 框架(`create_deep_agent`、内置中间件、`FilesystemPermission`、`SubAgent`)|
| `deepagents-acp` | ACP 协议服务(`AgentServerACP`)|
| `langgraph` | 图运行时、checkpointer |
| `langchain` | `create_agent`、`AgentMiddleware`、内置中间件(`SummarizationMiddleware`、`HumanInTheLoopMiddleware`、`TodoListMiddleware`)|
| `langchain-anthropic` / `langchain-openai` / `langchain-google-genai` | 模型 provider |
| `agent-client-protocol` | ACP SDK(`deepagents-acp` 依赖)|

---

## Agent 构建

### agent_config.py — 核心工厂(单一来源)

```python
# src/deepagents_app_py/runtime/agent_config.py
def build_agent_config_parts(config, session_config, workspace_root, tools, *, checkpointer=None) -> dict:
    """组装 create_deep_agent(**parts) 的关键字参数:
       model, system_prompt, tools, middleware, subagents,
       skills, memory, permissions, interrupt_on, checkpointer。"""

def build_graph(config, session_config, workspace_root, tools, *, checkpointer=None):
    """= create_deep_agent(**build_agent_config_parts(...));ACP 与 CLI 共用。"""
```

**组装流程**:
1. `resolve_model(config)` → langchain `BaseChatModel`
2. `resolve_system_prompt()` + 运行时上下文 + 模式前言(plan/yolo)
3. `tools` — langchain 工具列表(见下)
4. `build_middleware(config, workspace_root)` → `list[AgentMiddleware]`
5. `build_permissions(...)` → `list[FilesystemPermission]`(含 protected-path deny)
6. `build_interrupt_on(...)` → HITL 的 `interrupt_on` dict

### 模型解析

```python
# src/deepagents_app_py/runtime/model.py — 返回 langchain ChatModel(自动缓存)
# "anthropic"/"claude" → ChatAnthropic
# "openai"             → ChatOpenAI
# "google"/"gemini"    → ChatGoogleGenerativeAI
# "groq"               → ChatOpenAI(groq 兼容端点)
model = resolve_model(config)
```
API Key 优先级:Anthropic `AUTH_TOKEN_ENV > API_KEY_ENV > ANTHROPIC_AUTH_TOKEN > ANTHROPIC_API_KEY`;OpenAI `OPENAI_API_KEY > API_KEY_ENV > AUTH_TOKEN_ENV`。

---

## 中间件链(langchain AgentMiddleware)

```python
# src/deepagents_app_py/runtime/middleware/__init__.py
# build_middleware(config, workspace_root) -> list[AgentMiddleware]
# 自研:HarnessLifecycle / PeriodicReminder / CostTracking / StuckLoop / Eviction
# 钩子方法:before_model / after_model / wrap_tool_call / wrap_model_call
```
**注意**:compaction(摘要压缩)、HITL、todo 由 deepagents/langchain **内置中间件**提供——**不要**再加 `SummarizationMiddleware`,`create_agent` 会判重复报错。protected paths 走 `FilesystemPermission(mode="deny")`,相对路径由 deepagents 的 `FilesystemBackend` 处理。

---

## 工具注册模式(langchain @tool)

```python
# src/deepagents_app_py/app/tools/<name>.py
from langchain_core.tools import tool

@tool
def my_tool(arg: str) -> str:
    """工具说明(会作为 description)。"""
    return ...

# src/deepagents_app_py/app/tools/__init__.py
def collect_tools() -> list[BaseTool]:
    return [http_request, runtime_info, json_utils, agent_variable, agent_memory, platform_api, mcp_bridge]
```
工厂把 `collect_tools()` 传给 `create_deep_agent(tools=...)`。文件系统/shell/todo 工具由 deepagents 内置,无需自写。详见 `langchain-core-tools` / `tool-creator-py` 技能。

---

## ACP 服务

```python
# src/deepagents_app_py/surfaces/acp/server.py
from acp import run_agent
from deepagents_app_py.surfaces.acp.session_lifecycle import DeepAgentsAppServer  # AgentServerACP 子类(补 name/version)

factory = build_acp_agent_factory(config, workspace_root, session_config=...)  # (AgentSessionContext)->CompiledStateGraph
server = DeepAgentsAppServer(agent=factory, models=models, server_name=..., server_version=...)
await run_agent(server)
```
官方 `AgentServerACP` 已内置 LangGraph 流式、HITL 权限提示、模型切换(`models=` + `ctx.model`)、todo/计划、多模态。

---

## 验证命令

```bash
uv sync --group dev      # 安装依赖
uv run pytest            # 测试
uv run ruff check .      # Lint
uv run pyright           # 类型检查
uv run deepagents-app-py chat   # 跑 agent(需 provider 凭证)
```

## Anti-patterns

- ❌ 用 `pydantic-ai`(已废弃)——一律用 LangGraph + deepagents
- ❌ 在 `runtime/` 改框架代码(只在 `app/` 加工具/钩子)
- ❌ 直接 `create_deep_agent()` 绕过 `build_agent_config_parts()`(会丢中间件/权限/技能)
- ❌ 再加一个 `SummarizationMiddleware`(deepagents 已内置,重复会报错)
- ❌ 工具里硬编码密钥(用 `os.environ.get("AGENT_VAR_XXX")` 或 agent variable)
- ✅ 新工具放 `app/tools/`,导出 langchain `@tool`,在 `collect_tools()` 注册
- ✅ 全部用 `uv run`,编译+测试通过再报完成
