---
name: tool-creator-py
description: "在 Python 模板中创建新工具的完整流程:langchain @tool → collect_tools() 注册"
tags: [tools, python, langchain, deepagents, development]
version: "2.0.0"
---

# 工具创建器(Python 模板)

## When to Use

需要为 Python 模板添加新的自定义工具时使用。Python 模板基于 **LangGraph + deepagents**,工具是 LangChain `@tool`(不再是 pydantic-ai 的 dict 声明)。

## 前置检查(必须)

在写任何代码之前:
1. 查询平台插件:`platform_api(operation="query_plugins", params={"query": "<所需能力>"})`
2. 检查现有工具:读取 `src/deepagents_app_py/app/tools/`
3. 确认不与 deepagents **内置工具**重复(`read_file`/`write_file`/`edit_file`/`ls`/`glob`/`grep`/`execute`/`task`)
4. 确认没有现成方案后,才开始创建

---

## 创建步骤

### Step 1: 创建工具文件 `src/deepagents_app_py/app/tools/{name}.py`

**简单工具(无外部依赖):**

```python
from __future__ import annotations

from langchain_core.tools import tool


@tool
def get_weather(city: str, unit: str = "celsius") -> str:
    """获取指定城市的当前天气信息。

    Args:
        city: 城市名称,如 'Beijing' 或 '北京'。
        unit: 温度单位 — celsius 或 fahrenheit。
    """
    # 真实实现:发请求 / 计算,返回字符串结果
    return f"{city}: 22°{unit[0].upper()}"
```

**需要 API key 的工具:**

```python
import os

import httpx
from langchain_core.tools import tool


@tool
def my_service(query: str) -> str:
    """调用 My Service API 执行查询。"""
    key = os.environ.get("AGENT_VAR_MY_SERVICE_KEY")  # 禁止硬编码
    if not key:
        return "AGENT_VAR_MY_SERVICE_KEY 未配置"
    resp = httpx.get("https://api.example.com", params={"q": query},
                     headers={"Authorization": f"Bearer {key}"}, timeout=30)
    return resp.text[:4000]
```

> **关键**:`@tool` 函数的 **docstring 就是工具描述**,**类型注解就是参数 schema**;函数体是**真实执行逻辑**。这与旧的 pydantic-ai 写法(只返回 `dict` schema、没有实现)根本不同。

### Step 2: 注册到 `collect_tools()`

`src/deepagents_app_py/app/tools/__init__.py`:

```python
from deepagents_app_py.app.tools.weather import get_weather

def collect_tools() -> list[BaseTool]:
    return [
        # ... 现有工具
        get_weather,
    ]
```

工厂(`surfaces/acp/config_builder.py` 和 CLI)会把 `collect_tools()` 传给 `create_deep_agent(tools=...)`,无需改 `agent_config.py`。

### Step 3: 处理外部依赖

1. 用 `agent_variable` 创建占位变量(`AGENT_VAR_XXX`)
2. 运行时 `os.environ.get("AGENT_VAR_XXX")` 读取
3. **禁止**硬编码密钥

### Step 4: 验证

```bash
uv run ruff check .     # Lint
uv run pyright          # 类型检查
uv run pytest           # 测试
```

---

## 命名规范

| 规则 | 示例 |
|------|------|
| 文件名:`{name}.py` | `weather.py` |
| 工具名 = 函数名:`snake_case` | `get_weather` |
| 装饰器 | `@tool`(`langchain_core.tools`) |
| 返回类型 | `str`(给模型看的文本结果) |

## 与 TS 模板的对比

| TS 模板 | Python 模板 |
|---------|------------|
| `{name}.tool.ts` | `{name}.py` |
| `tool()` from `@langchain/core/tools` + Zod | `@tool` from `langchain_core.tools` + 类型注解 |
| `createTools()` 注册 | `collect_tools()` 注册 |
| `pnpm run build` 验证 | `uv run ruff check .` + `uv run pyright` |

## Anti-patterns

- ❌ 返回 `dict[str, Any]` 的 JSON Schema 声明(pydantic-ai 旧写法,**已废弃**)——必须用 `@tool` 真实函数
- ❌ 用 pydantic-ai / `create_xxx_tool()` 工厂
- ❌ 和 deepagents 内置工具重复(read_file/write_file/execute/task…)
- ❌ 在工具代码中硬编码 API key
- ✅ docstring + 类型注解齐全(它们就是工具的 description 和 schema)
- ✅ 在 `collect_tools()` 注册
- ✅ 用 `agent_variable` 管理密钥
