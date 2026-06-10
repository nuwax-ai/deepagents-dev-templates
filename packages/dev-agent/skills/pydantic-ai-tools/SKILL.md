---
name: pydantic-ai-tools
description: "pydantic-ai 工具开发参考：create_xxx_tool() 工厂函数、JSON Schema 参数定义、工具注册（Python 模板专用）"
tags: [pydantic-ai, tools, json-schema, python, structured-tool]
version: "1.0.0"
---

# pydantic-ai 工具开发参考（Python 模板）

## When to Use

需要在 `src/deepagents_app_py/app/tools/` 下创建新工具时使用——包括工厂函数模式、JSON Schema 设计、工具注册。

---

## 核心：create_xxx_tool() 工厂函数

所有工具通过 `create_<name>_tool()` 工厂函数创建，返回 `dict[str, Any]`：

```python
# src/deepagents_app_py/app/tools/my_tool.py
from __future__ import annotations
from typing import Any

def create_my_tool() -> dict[str, Any]:
    return {
        "name": "my_tool",           # 工具名：snake_case
        "description": "工具功能描述，说明何时使用",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜索内容"},
                "limit": {"type": "integer", "default": 10, "description": "最大返回条数"},
            },
            "required": ["query"],
        },
    }
```

**与 TS 模板的对比**：

| TS 模板 | Python 模板 |
|---------|------------|
| `tool()` from `@langchain/core/tools` | `create_xxx_tool()` 返回 `dict` |
| Zod schema (`z.object({...})`) | JSON Schema (`{"type": "object", ...}`) |
| `StructuredTool` 实例 | `dict[str, Any]` |
| `.describe()` 链式调用 | `"description"` 字段 |
| `.default()` 链式调用 | `"default"` 字段 |
| `.optional()` | 省略 `"required"` |

---

## JSON Schema 设计规范

```python
"parameters": {
    "type": "object",
    "properties": {
        # 必填字段
        "url": {"type": "string", "description": "目标 URL"},

        # 枚举类型
        "method": {
            "type": "string",
            "enum": ["GET", "POST", "PUT", "DELETE"],
            "default": "GET",
            "description": "HTTP 方法",
        },

        # 可选字段（不在 required 中）
        "headers": {
            "type": "object",
            "additionalProperties": {"type": "string"},
            "description": "请求头键值对",
        },

        # 带默认值
        "timeout": {
            "type": "integer",
            "default": 30000,
            "description": "超时毫秒数",
        },

        # 数组类型
        "tags": {
            "type": "array",
            "items": {"type": "string"},
            "default": [],
            "description": "标签列表",
        },
    },
    "required": ["url"],
}
```

**规则**：
- 每个字段必须加 `"description"` — LLM 依赖这些描述来正确填参
- 有合理默认值的用 `"default"`，不要求必填
- 真正可选的不放入 `"required"` 数组

---

## 工具文件结构

### 内置工具列表

| 文件 | 工具名 | 功能 |
|------|--------|------|
| `platform_api.py` | `platform_api` | nuwax 平台 API |
| `http_request.py` | `http_request` | HTTP 请求 |
| `json_utils.py` | `json_utils` | JSON 处理 |
| `agent_variable.py` | `agent_variable` | 变量管理 |
| `agent_memory.py` | `agent_memory` | 内存读写 |
| `mcp_bridge.py` | `mcp_bridge` | MCP 工具桥接 |
| `checkpoint.py` | `checkpoint` | 状态存档 |
| `conversation_history.py` | `conversation_history` | 对话历史 |
| `runtime_info.py` | `runtime_info` | 运行时信息 |

### 注册方式

工具在 `agent_config.py` 的 `build_agent_config_parts()` 中组装到 `tools` 列表，最终传入 `Agent()` 构造器：

```python
# agent_config.py 中的组装
parts = {
    "model": model,
    "system_prompt": system_prompt,
    "tools": tools,           # ← list[dict[str, Any]]
    "model_settings": model_settings,
    # ...
}
```

---

## 前置检查（写工具前必须执行）

```python
# 1. 先查询平台是否已有现成插件
platform_api(operation="query_plugins", params={"query": "weather api"})

# 2. 检查现有工具：读取 src/deepagents_app_py/app/tools/ 目录
# 3. 确认无现成方案后，再创建自定义工具
```

## Anti-patterns

- ❌ 在工具代码中硬编码 API key
- ❌ 忘记给字段加 `"description"`（LLM 会乱填参数）
- ❌ 使用 pydantic `BaseModel` 作为参数（当前模板使用原生 JSON Schema）
- ❌ 不在 `agent_config.py` 中注册就以为工具可用
- ✅ API key 通过 `os.environ.get("AGENT_VAR_XXX")` 读取
- ✅ 工具返回描述性错误字符串而不是抛出异常
- ✅ 写完工具后运行 `uv run ruff check .` + `uv run pyright` 验证
