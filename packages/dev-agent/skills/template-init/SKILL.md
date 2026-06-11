---
name: template-init
description: "检测模板项目结构、识别编辑区域、理解配置优先级链。支持 TS 和 Python 两种模板"
tags: [template, init, structure, zones]
version: "2.0.0"
---

# 模板初始化检测

## When to Use
开始任何开发任务前，必须先执行此技能了解项目结构。

## 检测步骤

### Step 1: 确认模板类型

检查项目根目录下的包管理文件来判断模板类型：

| 标志文件 | 模板类型 | 包管理器 |
|----------|----------|----------|
| `package.json` + `pnpm` | `deepagents-app-ts`（TypeScript） | `pnpm` |
| `pyproject.toml` + `uv.lock` | `deepagents-app-py`（Python） | `uv` |

**TS 模板**：确认 `package.json` 中 `name` 包含 `deepagents`、`dependencies` 包含 `deepagents` 和 `deepagents-acp`、`type` 为 `"module"`。

**Python 模板**：确认 `pyproject.toml` 中 `name` 包含 `deepagents`、`dependencies` 包含 `deepagents`、`deepagents-acp`、`langgraph`。

### Step 2: 读取模板清单

读取 `template.manifest.json`，了解：
- 区域划分（protected / ai-editable / user-editable）
- 验收命令列表
- 约束条件（promptSource、toolPriority、variableCreation）

### Step 3: 扫描目录结构

#### TypeScript 模板 (`deepagents-app-ts`)
```
src/runtime/  → 🚫 保护区（列出文件，确认不修改）
src/surfaces/ → 🚫 保护区（ACP/CLI 入口）
src/app/      → ✅ AI 可编辑区（列出现有工具、适配器）
skills/       → ✅ 技能目录（列出 builtin/ 和 platform/ 下的技能）
prompts/      → ✅ 提示词目录（列出系统提示词和片段）
config/       → ⚙️ 用户配置（读取 app-agent.config.json）
```

#### Python 模板 (`deepagents-app-py`)
```
src/deepagents_app_py/runtime/   → 🚫 保护区（config、middleware、platform、storage）
src/deepagents_app_py/surfaces/  → 🚫 保护区（ACP server、CLI 入口）
src/deepagents_app_py/app/       → ✅ AI 可编辑区（列出现有工具、hooks）
prompts/                         → ✅ 提示词目录
skills/                          → ✅ 技能目录
config/                          → ⚙️ 用户配置
```

### Step 4: 读取当前配置

#### TS 模板
```json
// config/app-agent.config.json 关键字段
{
  "agent": { "name", "description", "version" },
  "model": { "provider", "name", "baseUrl" },
  "mcp": { "configPath", "mergeStrategy" },
  "permissions": { "interruptOn", "allowedPaths", "deniedPaths" }
}
```

#### Python 模板
读取 `config/` 下的 JSON 配置文件，关注 agent 名称、模型、MCP 服务器等设置。

### Step 5: 安装依赖 & 验证可用

#### TypeScript 模板
```bash
pnpm install               # 安装依赖（若 node_modules 缺失）
pnpm run build              # 编译
pnpm test                   # 运行测试
pnpm run typecheck          # 类型检查
```

#### Python 模板
```bash
uv sync --group dev         # 安装依赖（含开发依赖）
uv run pytest               # 运行测试
uv run ruff check .         # Lint
uv run pyright              # 类型检查
```

### Step 6: 读取平台状态

检查是否有平台凭据：
- `PLATFORM_AGENT_ID` 和 `PLATFORM_SPACE_ID` 是否配置
- 是否连接到 nuwaclaw 平台（local-only 模式 vs platform 模式）

## 输出格式
```
📋 模板检测结果：
- 模板类型：TS / Python
- 模板版本：X.Y.Z
- Agent 名称：xxx
- 包管理器：pnpm / uv
- 模式：local-only / platform
- 现有工具：N 个（列出名称）
- 现有技能：N 个（列出名称）
- MCP 服务器：N 个（列出名称）
- 待处理事项：（如有缺失配置）
```

## Anti-patterns
- ❌ 跳过检测直接写代码 — 可能误改保护区
- ❌ 忽略 template.manifest.json — 这是约束的唯一来源
- ❌ 用 npm 代替 pnpm — 项目已切换为 pnpm，统一使用 pnpm
- ✅ 每次开发任务开始前都执行检测
- ✅ 检测结果作为后续开发步骤的输入
