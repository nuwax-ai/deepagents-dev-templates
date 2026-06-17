# LangGraph 工具开发对接指南

平台提供的工具**必须先搜索并添加到 Agent 配置**（见 `SKILL.md` 与 `api-docs.md`），之后才能在 LangGraph 中使用。本文说明第 3 步——**按平台返回的 `schema` 进行 LangGraph 工具开发**。

> **写进代码的，只有"实际要用到的工具"本身。** 这里的 `@tool` 函数实现的是**该工具自己的业务逻辑**（你写的、运行时被智能体调用的代码），与 dev 配置接口（config/search/add/del/update）无关——dev 接口只在开发期手动跑，绝不 import 到 LangGraph 业务代码里。

## 对接模型

平台工具的 `schema` 字段是**字符串化的 JSON Schema**，描述了该工具的入参（字段名、类型、是否必填）。LangGraph 侧的核心任务：**让本地定义的工具入参与平台 schema 完全对齐**，再用 `bind_tools` 绑定到 LLM，使模型按 schema 决策调用。

```
开发期（不进代码）：搜索 → 拿到 schema → tool/add 加进配置
                              │
                              ▼  schema 作为依据
运行时（写进代码）：LangGraph @tool（pydantic args_schema）
                              │  bind_tools
                              ▼
                    LLM（按 schema 生成 tool call）──► @tool 执行业务逻辑
```

> LangGraph 里定义的工具必须与配置中添加的工具指向同一 `targetType`+`targetId`，这样模型生成的 tool call 才能被正确路由/对应。

## 第一步：解析平台 schema

先看清工具的入参定义：

```bash
echo '<搜索结果里的 schema 字符串>' | python3 -c "import json,sys; print(json.dumps(json.loads(sys.stdin.read()), ensure_ascii=False, indent=2))"
```

假设解析出的 schema 形如：

```json
{
  "type": "object",
  "properties": {
    "query": {"type": "string", "description": "搜索关键词"},
    "limit": {"type": "integer", "description": "返回条数", "default": 10}
  },
  "required": ["query"]
}
```

## 第二步：用 pydantic 模型对齐 schema，再用 @tool 包装

以平台 schema 为准定义入参模型，**字段名、类型、必填必须与 schema 一致**：

```python
from pydantic import BaseModel, Field
from langchain_core.tools import tool


# ① 入参模型：字段名/类型/必填对齐平台 schema 的 properties / required
class SearchInput(BaseModel):
    query: str = Field(description="搜索关键词")          # schema 中 required
    limit: int = Field(default=10, description="返回条数")  # schema 中非必填，带 default


# ② 用 @tool 包装，args_schema 显式绑定到平台 schema
@tool(args_schema=SearchInput)
def platform_search(query: str, limit: int = 10) -> str:
    """按关键词在平台检索。"""  # docstring 会作为工具说明传给 LLM
    # ⚠️ 这里写的是「这个工具自己的业务逻辑」——即运行时智能体调用它时真正执行的代码。
    #    不是去调 dev 配置接口（config/search/add 那些只用于开发期配置，不写进这里）。
    #    例如：查询数据库 / 调用某个内部 API / 跑一段计算等。
    # 入参 query/limit 与平台 schema 完全一致。
    ...
    return f"检索 {query} 的前 {limit} 条结果"
```

要点：

- **字段名严格对齐** `schema.properties`——LLM 按 schema 生成参数，名字不一致会调用失败。
- **类型对齐**：`string`→`str`、`integer`→`int`、`number`→`float`、`boolean`→`bool`、`array`→`list`、`object`→`dict`。
- **必填对齐** `schema.required`：在 pydantic 模型里这些字段不设默认值，其余字段给默认值。
- **description 对齐**：尽量复用 schema 里各字段的 description，提高模型调用准确率。

## 第三步：绑定到 LLM（bind_tools）

把对齐后的工具绑定到聊天模型，模型即可按 schema 决策调用：

```python
from langchain_anthropic import ChatAnthropic
from langgraph.prebuilt import create_react_agent

tools = [platform_search]
model = ChatAnthropic(model="claude-3-7-sonnet-latest")

# 方式 A：直接绑定工具（自行编排图节点时）
bound_model = model.bind_tools(tools)

# 方式 B：用预置 ReAct agent（最简）
app = create_react_agent(model, tools)
app.invoke({"messages": [{"role": "user", "content": "帮我搜索一下天气"}]})
```

## 系统提示词与开场白

系统提示词**保存到平台配置**（见 `SKILL.md` 第 5 步 / `api-docs.md` 第 2 节），LangGraph 运行时统一读取，**不要在代码里硬编码重复一份**，避免与平台配置不一致。如需在 LangGraph 侧引用，从平台 config 接口取值后再注入 messages，保证单一数据源。

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| LLM 生成了 tool call 但平台报参数错误 | LangGraph 工具字段名/类型与平台 schema 不一致 | 用第一步解析 schema，逐字段对齐 pydantic 模型 |
| 模型从不调用该工具 | 工具未添加到配置 / docstring 不清晰 | 先 `tool/add` 进配置；完善 `@tool` 的 docstring |
| 必填字段缺失导致失败 | pydantic 模型把必填字段也设了默认值 | `schema.required` 中的字段不设默认值 |
| 添加与实现的工具不匹配 | 加 A 调 B | 配置中 `targetId` 与 LangGraph 实现的工具指向同一项 |

## Anti-patterns

- ❌ **在 `@tool` 函数体里调用 dev 配置接口**（config/search/add/del/update）——dev 接口是开发期手动跑的配置工具，不写进业务代码；`@tool` 里只写该工具自己的业务逻辑。
- ❌ 按 LLM 的"常识"给工具起字段名，不对照平台 schema。
- ❌ 把系统提示词同时硬编码在 LangGraph 代码里又存一份到平台——以平台配置为单一数据源。
- ❌ 没把工具 `tool/add` 进配置就直接 `bind_tools`——平台不会路由。
- ✅ 平台 schema → pydantic `args_schema` → `@tool` → `bind_tools`，一路对齐。
- ✅ **代码里只有"实际用到的工具"**；dev 接口留给开发期配置，两者分离。

## 参考版本

- `@tool`：`langchain_core.tools.tool`
- `bind_tools`：聊天模型方法（`ChatAnthropic` / `ChatOpenAI` 等）
- `create_react_agent`：`langgraph.prebuilt`
- pydantic：v2（`BaseModel`、`Field`）
