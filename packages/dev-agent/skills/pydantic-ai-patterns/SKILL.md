---
name: pydantic-ai-patterns
description: "pydantic-ai 核心模式：Agent 构建、中间件钩子、子 agent、上下文压缩、流式输出（Python 模板专用）"
tags: [pydantic-ai, agent, middleware, streaming, python]
version: "1.0.0"
---

# pydantic-ai 使用模式（Python 模板）

## When to Use

需要理解 Python 模板内部的 pydantic-ai 模式时使用——包括 Agent 构成、中间件钩子、子 agent 编排、上下文管理。

---

## 核心概念

Python 模板基于 `pydantic-ai` 构建，与 TS 模板的 LangGraph 有本质区别：

| 概念 | TS (LangGraph) | Python (pydantic-ai) |
|------|----------------|---------------------|
| 编排模型 | `StateGraph` + 节点/边 | `Agent` 类 + 钩子函数 |
| 状态管理 | `MessagesAnnotation` | 内置消息历史 |
| 工具调用循环 | 自定义 `toolNode` | 内建 tool loop |
| 中间件 | LangGraph middleware | `before_model` / `after_model` / `before_tool` / `after_tool` 钩子 |
| 检查点 | `MemorySaver` | `checkpointer` 参数 |
| 子 agent | 嵌套 StateGraph | `subagents-pydantic-ai` |

**开发者不需要直接构建 Agent**，只需要：
1. 在 `src/deepagents_app_py/app/tools/` 创建工具
2. 在 `agent_config.py` 中注册
3. 框架自动把工具绑定到 Agent

---

## Agent 构建模式

```python
# agent_config.py 中的组装
from pydantic_ai import ModelSettings

parts = build_agent_config_parts(config, workspace_root, tools)

# parts 结构：
{
    "model": <pydantic-ai Model>,          # AnthropicModel / OpenAIModel / GeminiModel
    "system_prompt": str,                   # 组合后的系统提示词
    "tools": list[dict[str, Any]],          # 工具列表
    "model_settings": ModelSettings | None, # temperature, max_tokens
    "middleware_hooks": {                   # 中间件链
        "before_model": [...],
        "after_model": [...],
        "before_tool": [...],
        "after_tool": [...],
    },
    "skills_paths": [...],                  # 技能目录
    "memory_paths": [...],                  # 内存文件
    "sub_agents": [...],                    # 子 agent
    "permissions": {...},                   # 文件权限
    "interrupt_on": {...},                  # 中断配置
    "checkpointer": ...,                   # 状态持久化
}
```

---

## 中间件钩子

pydantic-ai 提供 4 个钩子点，模板内置 8 个中间件：

### before_model（模型调用前）

```python
# 1. harness_lifecycle — turn 开始追踪
# 2. periodic_reminder — 每 N 轮注入上下文提醒
# 3. compaction — 上下文溢出时 LLM 摘要压缩
```

### after_model（模型返回后）

```python
# 1. cost_tracking — token 使用量追踪 + 阈值告警
```

### before_tool（工具调用前）

```python
# 1. fs_path_resolver — 相对路径解析为绝对路径
# 2. protected_paths — 写保护路径拦截
```

### after_tool（工具返回后）

```python
# 1. stuck_loop — 检测重复相同工具调用
# 2. eviction — 大输出截断（保留头尾预览）
```

---

## 上下文管理

### Compaction（压缩）

```python
# config/app-agent.config.json
{
  "compaction": {
    "enabled": true,
    "triggerThreshold": 0.75,    # 使用量达 75% 时触发
    "contextWindow": 200000,      # 上下文窗口大小
    "keepRecentTokens": 40000     # 保留最近 40k tokens
  }
}
```

使用 `summarization-pydantic-ai` 包，通过 LLM 对旧消息做摘要。

### Eviction（淘汰）

```python
{
  "eviction": {
    "enabled": true,
    "tokenLimit": 8000,          # 超过此长度的工具输出会被截断
    "headLines": 50,             # 保留头部行数
    "tailLines": 20              # 保留尾部行数
  }
}
```

---

## 子 Agent 编排

```python
# 通过 subagents-pydantic-ai 包实现
# 在 agent_config.py 中自动发现 .agents/ 目录下的子 agent 定义

sub_agents = discover_sub_agents(config, workspace_root)
```

---

## 模型 Provider 解析

```python
# model.py — 支持 4 个 provider:
provider_map = {
    "anthropic": AnthropicModel,
    "claude":    AnthropicModel,
    "openai":    OpenAIModel,
    "google":    GeminiModel,
    "gemini":    GeminiModel,
    "groq":      OpenAIModel,  # 兼容端点
}
# 未知 provider → 回退到 OpenAIModel
```

---

## 与 deepagents 框架的集成关系

Python 模板在 `build_agent_config_parts()` 中已封装好所有组装步骤。**开发者不需要直接写 Agent 构造代码**，只需要：
1. 在 `src/deepagents_app_py/app/tools/` 创建工具
2. 在 `agent_config.py` 中注册到 tools 列表
3. 框架自动把工具和中间件绑定到 Agent

---

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| Agent 启动后无响应 | 模型 API key 缺失 | 检查 `.env` 或环境变量 |
| 中间件未生效 | 未在 `build_agent_config_parts` 中注册 | 检查 `middleware_hooks` 组装 |
| 工具调用死循环 | stuck_loop 中间件阈值太高 | 调低 `threshold` |
| 上下文溢出 | compaction 未启用 | 设置 `compaction.enabled: true` |

## Anti-patterns

- ❌ 在模板中直接绕过 `build_agent_config_parts()` 自己构建 Agent
- ❌ 在钩子函数中做耗时 I/O（阻塞事件循环）
- ❌ 不配置 compaction 就处理长对话（会超出上下文窗口）
- ✅ 利用中间件链处理横切关注点（日志、权限、成本）
- ✅ 钩子函数保持轻量，只做路由/拦截逻辑
- ✅ 每个 `create_xxx_middleware()` 只负责一件事
