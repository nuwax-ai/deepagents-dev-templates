---
name: deepagents-framework-py
description: "pydantic-ai 框架核心 API 参考：Agent 构建、模型解析、工具注册、配置结构和中间件链（Python 模板专用）"
tags: [deepagents, pydantic-ai, framework, api, tools, config, python]
version: "1.0.0"
---

# pydantic-ai 框架参考（Python 模板）

## When to Use

需要理解或使用 Python 模板的 `pydantic-ai` 框架 API 时使用——包括 Agent 构建、模型解析、工具注册、中间件链、配置结构。

---

## 核心架构

Python 模板基于 `pydantic-ai` 构建（非 LangGraph）。关键对应关系：

| TS 模板 | Python 模板 |
|---------|------------|
| `deepagents` npm 包 | `pydantic-ai` + 生态包 |
| `@langchain/langgraph` | `pydantic-ai` Agent |
| `@langchain/core/tools` + Zod | `dict` JSON Schema 工具定义 |
| `MemorySaver` (LangGraph) | `checkpointer` (pydantic-ai) |
| `npm` / `pnpm` | `uv` |

---

## 依赖生态

| 包名 | 用途 |
|------|------|
| `pydantic-ai` | 核心 Agent 框架 |
| `pydantic-ai-slim[anthropic,openai,web-fetch]` | 精简版 + 模型 provider |
| `pydantic-ai-backend[console]` | Agent 执行后端 |
| `pydantic-ai-todo` | 任务管理 |
| `pydantic-ai-shields` | 安全护栏 |
| `summarization-pydantic-ai` | 上下文压缩/摘要 |
| `subagents-pydantic-ai` | 子 agent 编排 |
| `agent-client-protocol` | ACP SDK（可选） |

---

## Agent 构建

### agent_config.py — 核心工厂

```python
# src/deepagents_app_py/runtime/agent_config.py
from pydantic_ai import ModelSettings

def build_agent_config_parts(
    config: AppConfig,
    workspace_root: str,
    tools: list[dict[str, Any]],
    *,
    session_config: ACPSessionConfig | None = None,
    checkpointer: Any = None,
) -> dict[str, Any]:
    """组装 pydantic-ai Agent(**parts) 的关键字参数。

    返回的 dict 可直接解包到 Agent() 构造器：
      model, system_prompt, tools, model_settings,
      middleware_hooks, skills_paths, memory_paths, ...
    """
```

**组装流程**：
1. `resolve_model(config)` — 解析 provider → Model 实例
2. `ModelSettings` — temperature, max_tokens
3. `resolve_system_prompt()` — 组合系统提示词
4. `tools` — 工具列表（`dict[str, Any]`）
5. 中间件链 — 8 个钩子组装为 `middleware_hooks`
6. `resolve_skills_paths()` / `discover_memory_files()` — 技能和内存发现

### 模型解析

```python
# src/deepagents_app_py/runtime/model.py

# 支持的 provider:
# "anthropic" / "claude"  → AnthropicModel
# "openai"                → OpenAIModel
# "google" / "gemini"     → GeminiModel
# "groq"                  → OpenAIModel (兼容端点)

model = resolve_model(config)  # 自动缓存
```

API Key 解析优先级：
- Anthropic: `AUTH_TOKEN_ENV` > `API_KEY_ENV` > `ANTHROPIC_AUTH_TOKEN` > `ANTHROPIC_API_KEY`
- OpenAI: `OPENAI_API_KEY` > `API_KEY_ENV` > `AUTH_TOKEN_ENV`

---

## 配置结构 AppConfig

```python
# config/app-agent.config.json → Pydantic 模型
# 所有模型继承 _CamelModel（自动 camelCase ↔ snake_case 转换）

class AppConfig(_CamelModel):
    agent: AgentConfig          # name, description, outputStyle
    model: ModelConfig          # provider, name, baseUrl, apiKeyEnv
    permissions: PermissionsConfig  # mode, interruptOn, allowedPaths, deniedPaths
    skills: SkillsConfig        # directories
    compaction: CompactionConfig    # enabled, triggerThreshold, contextWindow
    eviction: EvictionConfig        # enabled, tokenLimit, headLines, tailLines
    middleware: MiddlewareConfig    # stuck_loop, periodic_reminder, cost_tracking
    mcp: MCPConfig                  # configPath, mergeStrategy
    # ... 30+ Pydantic 模型
```

**配置优先级链（6 层，从低到高）**：
```
defaults < user ~/.deepagents < project .deepagents < template config < env vars < ACP session
```

---

## 中间件链

```python
# 8 个中间件，按执行顺序：
middleware_hooks = {
    "before_model": [
        harness_lifecycle,      # 每次 turn 开始追踪
        periodic_reminder,      # N 轮后注入上下文提醒
        compaction,             # 上下文溢出时摘要压缩
    ],
    "after_model": [
        cost_tracking,          # token 使用追踪
    ],
    "before_tool": [
        fs_path_resolver,       # 相对路径 → 绝对路径
        protected_paths,        # 写保护路径拦截
    ],
    "after_tool": [
        stuck_loop,             # 重复调用检测
        eviction,               # 大输出截断（保留头尾）
    ],
}
```

---

## 工具注册模式

工具返回 `dict[str, Any]`，在 `agent_config.py` 中组装为 `tools` 列表：

```python
# src/deepagents_app_py/app/tools/http_request.py
def create_http_request_tool() -> dict[str, Any]:
    return {
        "name": "http_request",
        "description": "Make an HTTP request to a given URL",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL to request"},
                "method": {"type": "string", "enum": ["GET", "POST", "PUT", "DELETE"], "default": "GET"},
            },
            "required": ["url"],
        },
    }
```

详见 → `pydantic-ai-tools` 技能和 `tool-creator-py` 技能。

---

## 环境变量

| 变量 | 用途 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 |
| `ANTHROPIC_AUTH_TOKEN` | Anthropic 认证 token |
| `OPENAI_API_KEY` | OpenAI API 密钥 |
| `LLM_PROVIDER` | `anthropic` / `openai` / `gemini` / `groq` |
| `PLATFORM_API_TOKEN` | 平台 API 认证 token |
| `PLATFORM_AGENT_ID` | 平台 Agent ID |
| `PLATFORM_SPACE_ID` | 平台 Space ID |
| `ACP_SESSION_CONFIG_JSON` | ACP 会话配置 JSON |
| `DEEPAGENTS_WORKING_DIR` | 工作目录覆盖 |

---

## 验证命令

```bash
uv sync --group dev      # 安装依赖（含开发依赖）
uv run pytest            # 运行测试
uv run ruff check .      # Lint
uv run pyright           # 类型检查
uv build                 # 构建 wheel/sdist
```

## Anti-patterns

- ❌ 在 `src/deepagents_app_py/runtime/` 中修改框架代码（只能在 `app/` 添加工具）
- ❌ 直接构造 `Agent()` 而不用 `build_agent_config_parts()`（会丢失中间件链）
- ❌ 在工具代码中硬编码 API key（使用 `os.environ.get("AGENT_VAR_XXX")`）
- ❌ 在运行时代码中硬编码系统提示词（提示词从 ACP session 或文件加载）
- ✅ 新工具放在 `src/deepagents_app_py/app/tools/`
- ✅ 用 `uv run` 运行所有命令
- ✅ 编译和测试命令通过后再报告完成
