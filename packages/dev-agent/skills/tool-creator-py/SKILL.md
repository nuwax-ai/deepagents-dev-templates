---
name: tool-creator-py
description: "在 Python 模板中创建新工具的完整流程：JSON Schema → create_xxx_tool() → 注册"
tags: [tools, python, json-schema, development]
version: "1.0.0"
---

# 工具创建器（Python 模板）

## When to Use

需要为 Python 模板添加新的自定义工具时使用。

## 前置检查（必须）

在写任何代码之前：
1. 查询平台插件：`platform_api(operation="query_plugins", params={"query": "<所需能力>"})`
2. 检查现有工具：读取 `src/deepagents_app_py/app/tools/` 目录
3. 确认没有现成方案后，才开始创建

---

## 创建步骤

### Step 1: 创建工具文件

文件路径：`src/deepagents_app_py/app/tools/{name}.py`

**简单工具（无平台依赖）：**

```python
# src/deepagents_app_py/app/tools/weather.py
from __future__ import annotations
from typing import Any

def create_weather_tool() -> dict[str, Any]:
    return {
        "name": "get_weather",
        "description": "获取指定城市的当前天气信息",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "城市名称，如 'Beijing' 或 '北京'",
                },
                "unit": {
                    "type": "string",
                    "enum": ["celsius", "fahrenheit"],
                    "default": "celsius",
                    "description": "温度单位",
                },
            },
            "required": ["city"],
        },
    }
```

**需要外部 API key 的工具：**

```python
# src/deepagents_app_py/app/tools/my_service.py
from __future__ import annotations
import os
from typing import Any

def create_my_service_tool() -> dict[str, Any]:
    return {
        "name": "my_service",
        "description": "调用 My Service API 执行查询",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "查询内容",
                },
            },
            "required": ["query"],
        },
    }
```

> **注意**：工具定义返回的是 `dict` 声明。实际执行逻辑由 pydantic-ai Agent 运行时根据工具名路由。

### Step 2: 定义 JSON Schema 参数

- 所有输入参数必须有 `"description"` 说明
- 有默认值的用 `"default": value`
- 真正可选的不放入 `"required"` 数组
- 枚举值用 `"enum": [...]`
- 嵌套对象用 `"type": "object"` + `"properties"`
- 数组用 `"type": "array"` + `"items"`

### Step 3: 注册工具

在 `src/deepagents_app_py/runtime/agent_config.py` 中将工具加入列表：

```python
from deepagents_app_py.app.tools.weather import create_weather_tool

# 在工具组装处添加
tools = [
    # ... 现有工具
    create_weather_tool(),
]
```

### Step 4: 处理外部依赖

如果工具需要 API key 或外部凭据：
1. 使用 `agent_variable` 创建占位变量
2. 运行时通过 `os.environ.get("AGENT_VAR_XXX")` 获取
3. **禁止**在代码中硬编码任何密钥

### Step 5: 验证

```bash
uv run ruff check .     # Lint 检查
uv run pyright          # 类型检查
uv run pytest           # 运行测试
```

---

## 工具文件命名规范

| 规则 | 示例 |
|------|------|
| 文件名：`{name}.py` | `weather.py` |
| 工具名：`snake_case` | `"get_weather"` |
| 工厂函数：`create_{name}_tool()` | `create_weather_tool()` |
| 返回类型：`dict[str, Any]` | 始终一致 |

---

## 与 TS 模板的对比

| TS 模板 | Python 模板 |
|---------|------------|
| `{name}.tool.ts` | `{name}.py` |
| `tool()` from `@langchain/core/tools` | `create_xxx_tool()` 返回 `dict` |
| `z.object({...})` (Zod) | `{"type": "object", ...}` (JSON Schema) |
| `.js` 导入后缀 | 无特殊后缀 |
| `src/app/tools/index.ts` 注册 | `agent_config.py` 中组装 |
| `pnpm run build` 验证 | `uv run ruff check .` + `uv run pyright` |

---

## Anti-patterns

- ❌ 不查询平台就写自定义工具
- ❌ 在工具代码中硬编码 API key
- ❌ 使用 pydantic `BaseModel` 作为参数定义
- ❌ 不给 JSON Schema 字段加 `"description"`
- ✅ 先查平台，确认无方案再写
- ✅ 用 `agent_variable` 管理密钥
- ✅ 参考现有工具文件的结构
