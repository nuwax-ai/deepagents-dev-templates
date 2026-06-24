---
name: dev-engineer-toolkit
description: "当开发项目需要搜索可用工具（API）、可用技能（SKILL）、或进行项目配置（系统提示词、开场白等智能体配置）时使用。这是开发工程师的基础技能包，所有涉及额外API接口查询、技能发现、项目配置读写的场景都必须使用本技能。Keywords: API搜索, 技能搜索, 项目配置, 系统提示词, 开场白, agent配置, 工具搜索, tool search, skill discovery"
tags: [api-search, skill-search, project-config, dev-toolkit, agent-config, tool-discovery]
version: "1.2.0"
---

# 开发工程师工具包

## 概述

本技能为开发工程师Agent 提供四大基础能力：

| 能力 | 说明 | 脚本 |
|------|------|------|
| **搜索工具/API** | 搜索平台可用资源（插件 API、工作流 API、知识库等），按关键词检索 | `scripts/search-apis.sh` |
| **搜索技能** | 搜索平台中已注册的技能（SKILL），按关键词检索 | `scripts/search-skills.sh` |
| **注册工具** | 将搜索到的工具/技能（Plugin、Workflow、Knowledge、Skill）注册到当前项目，注册后方可调用 | `scripts/add-tool.sh` |
| **删除工具** | 从项目中移除已注册的工具/技能组件 | `scripts/remove-tool.sh` |
| **下载技能** | 将搜索到的技能下载并解压到项目目录 | `scripts/download-skill.sh` |
| **项目配置读写** | 读取/更新项目配置（系统提示词、开场白、模型参数等） | `scripts/get-config.sh` / `scripts/update-config.sh` |
| **Python 环境检测** | 检测 Python / uv 是否可用，缺失时可用 uv 安装 | `scripts/check-python.sh` |

> 搜索 API 与搜索技能共用同一个后端接口，通过 `type` 参数（`tool` / `skill`）区分搜索目标，脚本已封装好差异。

## When to Use

**必须使用本技能的场景：**

1. **需要新的 API 接口时** — 开发中需要调用某个功能接口，先通过 `search-apis.sh` 搜索平台是否已有可用 API，避免重复造轮子。
2. **需要查找已有技能时** — 开发中需要某个领域能力（如代码审查、测试生成），先通过 `search-skills.sh` 检索是否已有对应技能可复用。
3. **需要读取项目配置时** — 需要获取当前项目的系统提示词、开场白、模型设置等配置信息时，使用 `get-config.sh`。
4. **需要更新项目配置时** — 用户要求修改系统提示词、开场白、或任何项目级配置时，**必须**使用 `update-config.sh` 通过接口更新，不要仅本地修改文件。

### 环境准备

所有脚本依赖以下环境变量（在实际运行环境中由平台注入，脚本内部自动读取，用户无需传入）：

| 环境变量 | 说明 | 使用脚本 |
|----------|------|----------|
| `PLATFORM_BASE_URL` | 平台 API 基础地址 | 全部 |
| `SANDBOX_ACCESS_KEY` | 沙箱认证密钥（作为 Bearer Token 传递） | 全部 |
| `DEV_SPACE_ID` | 开发空间 ID | search-apis.sh, search-skills.sh, download-skill.sh |
| `DEV_AGENT_ID` | 开发的 Agent ID | add-tool.sh, remove-tool.sh, get-config.sh, update-config.sh（内部读取） |

脚本在缺失必需环境变量时会输出明确错误并退出。

### UTF-8 / Windows 编码（配置读写必读）

`get-config.sh` / `update-config.sh` 内部调用 **`get-config.py` / `update-config.py`**（标准库，无第三方依赖），请求头带 `Content-Type: application/json; charset=utf-8`，JSON 使用 `ensure_ascii=False`，避免中文 `systemPrompt` 乱码。

> 本地 **Windows** 上 Agent 命令走 **Git Bash**；`python3` 常为系统商店占位（不可用），实际可用的一般是 `python` 或 `py -3`。统一执行 `./scripts/*.sh`，**禁止** `python3` 失败后改手写 `curl`。

```bash
# 推荐：从 UTF-8 文件上传（含中文时长文本）
./scripts/update-config.sh --system-prompt-file prompts/flow.base.md
```

**含中文的长系统提示词**：务必用 `--system-prompt-file` 指向 **UTF-8** 文件，不要用 `--system-prompt` 在命令行内联多行中文。

**禁止**：

- 手写 `curl -d "..."` 拼含中文的 JSON body
- `python3` 失败时改用手写 curl（应先 `./scripts/check-python.sh --install`）

写操作后用 `get-config.sh --key systemPrompt` 核对平台端中文是否正确；若已乱码，用修复后的脚本**重新上传**覆盖。

### Python 环境检测（配置脚本依赖 Python 3）

`get-config.sh` / `update-config.sh` 依赖 Python 3 运行 `*.py`。**更新配置前建议先检测**：

```bash
./scripts/check-python.sh
# 仅当输出无可用 Python 且 PATH 中有 uv 时：
./scripts/check-python.sh --install
```

| 检测项 | 说明 |
|--------|------|
| `python3` | Windows 个人电脑上**常不可用**（商店占位）；脚本会自动跳过并尝试 `python` |
| `python` / `py -3` | Windows 上最常见可用入口 |
| `uv` | **不保证**在 PATH 中；有则 `check-python.sh --install` 可安装 Python |

环境变量：`DEV_TOOLKIT_UV_PYTHON`（默认 `3.12`）、`UV_PYTHON_DOWNLOADS=automatic`、`DEV_TOOLKIT_SKIP_UV=1` 禁止自动 uv 安装。

`update-config.sh` 启动时会自动探测；仅当 `python`/`py -3` 都不可用且 PATH 有 `uv` 时，才尝试 `uv python install`。

---

### 1. 搜索工具/API — `scripts/search-apis.sh`

在平台中搜索可用的工具和 API 资源（插件 API、工作流 API、知识库等）。

```bash
# 按关键词搜索
./scripts/search-apis.sh --kw "文件上传"

# 分页控制
./scripts/search-apis.sh --kw "auth" --page 1 --page-size 10

# 浏览全部（不分页）
./scripts/search-apis.sh --page-size 100

# 表格友好输出
./scripts/search-apis.sh --kw "notification" --format table
```

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--kw` | string | - | 搜索关键词，支持模糊匹配 |
| `--page` | int | 1 | 页码 |
| `--page-size` | int | 20 | 每页数量（1-100） |
| `--format` | json\|table | json | 输出格式 |

**返回格式（JSON）：**

```json
{
  "code": "0000",
  "success": true,
  "data": [
    {
      "targetType": "Plugin",
      "targetId": 123,
      "name": "文件上传",
      "description": "上传文件到对象存储",
      "schema": "{...接口定义...}"
    },
    {
      "targetType": "Workflow",
      "targetId": 456,
      "name": "审批流程",
      "description": "通用审批工作流"
    }
  ],
  "message": null
}
```

> `targetType` 枚举：`Plugin`（插件 API）、`Workflow`（工作流 API）、`Knowledge`（知识库）、`Skill`（技能）

> ⚠️ **环境变量占位约束**：搜索结果中 `schema` 字段包含 `${PLATFORM_BASE_URL}`、`${SANDBOX_ACCESS_KEY}`、`${DEV_SPACE_ID}` 等系统环境变量占位符。在使用这些 API 时**必须保持占位符原样**，不得将占位符替换为实际值硬编码。运行时由平台注入对应环境变量即可自动解析。

**退出码：**

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 参数错误 |
| 2 | 环境变量缺失（`PLATFORM_BASE_URL`、`SANDBOX_ACCESS_KEY`、`DEV_SPACE_ID`） |
| 3 | HTTP 请求失败 |
| 4 | 业务错误（`code` ≠ `0000`） |

---

### 2. 搜索技能 — `scripts/search-skills.sh`

在平台中搜索已注册的可用技能。与搜索 API 共用同一个后端接口，脚本内部使用 `type: "skill"`。

```bash
# 按关键词搜索
./scripts/search-skills.sh --kw "代码审查"

# 分页控制
./scripts/search-skills.sh --kw "debug" --page 1 --page-size 5

# 浏览全部
./scripts/search-skills.sh --page-size 100

# 表格友好输出
./scripts/search-skills.sh --kw "review" --format table
```

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--kw` | string | - | 搜索关键词 |
| `--page` | int | 1 | 页码 |
| `--page-size` | int | 20 | 每页数量（1-100） |
| `--format` | json\|table | json | 输出格式 |

**返回格式（JSON）：**

```json
{
  "code": "0000",
  "success": true,
  "data": [
    {
      "targetType": "Skill",
      "targetId": 789,
      "name": "code-review",
      "description": "审查代码变更，发现 bug 和改进点",
      "schema": "{...}"
    }
  ],
  "message": null
}
```

**退出码：**

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 参数错误 |
| 2 | 环境变量缺失 |
| 3 | HTTP 请求失败 |
| 4 | 业务错误（`code` ≠ `0000`） |

---

### 3. 注册工具 — `scripts/add-tool.sh`

向当前智能体项目注册/添加一个工具或技能。**搜索到的资源必须先注册才能调用**。

```bash
# 注册一个插件 API
./scripts/add-tool.sh --target-type "Plugin" --target-id 614

# 注册一个工作流
./scripts/add-tool.sh --target-type "Workflow" --target-id 123

# 注册一个知识库
./scripts/add-tool.sh --target-type "Knowledge" --target-id 528

# 注册一个技能
./scripts/add-tool.sh --target-type "Skill" --target-id 494
```

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--target-type` | string | - | 目标类型（**必填**）：`Plugin`、`Workflow`、`Knowledge`、`Skill` |
| `--target-id` | int | - | 目标对象 ID（**必填**），来自搜索结果的 `targetId` 字段 |

**返回示例：**

```
[OK] 工具注册成功
  Agent ID : 42
  类型     : Plugin
  目标 ID  : 614
```

**退出码：**

| 码 | 含义 |
|----|------|
| 0 | 注册成功 |
| 1 | 参数错误 |
| 2 | 环境变量缺失 |
| 3 | HTTP 请求失败 |
| 4 | 业务错误（`code` ≠ `0000`） |

---

### 4. 删除工具 — `scripts/remove-tool.sh`

从当前项目中移除已注册的工具或技能。

```bash
# 删除一个插件
./scripts/remove-tool.sh --target-type "Plugin" --target-id 614

# 删除一个知识库
./scripts/remove-tool.sh --target-type "Knowledge" --target-id 528

# 移除一个技能
./scripts/remove-tool.sh --target-type "Skill" --target-id 494
```

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--target-type` | string | - | 目标类型（**必填**）：`Plugin`、`Workflow`、`Knowledge`、`Skill` |
| `--target-id` | int | - | 目标对象 ID（**必填**） |

**退出码：**

| 码 | 含义 |
|----|------|
| 0 | 删除成功 |
| 1 | 参数错误 |
| 2 | 环境变量缺失 |
| 3 | HTTP 请求失败 |
| 4 | 业务错误 |

---

### 5. 下载技能 — `scripts/download-skill.sh`

将搜索到的技能下载并解压到项目目录。搜索结果中 `schema` 字段包含下载链接，脚本自动提取并下载。

```bash
# 下载指定技能到当前目录
./scripts/download-skill.sh --target-id 494

# 下载到指定目录
./scripts/download-skill.sh --target-id 494 --output-dir ./skills/
```

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--target-id` | int | - | 目标技能 ID（**必填**），来自 `search-skills.sh` 结果中的 `targetId` |
| `--output-dir` | path | `.` | 解压输出目录 |

**执行流程：**

1. 优先从 `get-config` 技能列表中查找 `downloadUrl`（干净字段）
2. 若未注册则回退到搜索接口，从 `schema` 文本中提取下载链接
3. 下载 `.zip` 文件
4. 解压到 `--output-dir` 指定目录
5. 清理临时文件，列出解压结果

**退出码：**

| 码 | 含义 |
|----|------|
| 0 | 下载解压成功 |
| 1 | 参数错误 |
| 2 | 环境变量缺失 |
| 3 | 查询或下载失败 |

---

### 6. 获取配置 — `scripts/get-config.sh`

读取当前智能体项目的完整配置，包括系统提示词、开场白、已注册的工具和技能列表、MCP 配置等。

```bash
# 查看项目完整配置
./scripts/get-config.sh

# 只看系统提示词
./scripts/get-config.sh --key systemPrompt

# 只看已注册工具列表
./scripts/get-config.sh --key tools

# 只看已注册技能列表（含下载链接）
./scripts/get-config.sh --key skills

# 查看开场白 / MCP 配置
./scripts/get-config.sh --key openingChatMsg
./scripts/get-config.sh --key mcpConfigs
```

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--key` | string | - | 只查看指定配置：`systemPrompt`、`openingChatMsg`、`tools`、`skills`、`mcpConfigs`；不填返回全部 |

**返回示例（完整配置）：**

```
========================================
  智能体 #3054 配置信息
========================================

--- 系统提示词 ---
你是一个专业的开发助手...

--- 开场白 ---
你好！我是你的开发助手。

--- 已注册工具 (4 个) ---
  [Plugin] #614 token价格查询_1
  [Knowledge] #528 Test

--- 已注册技能 (1 个) ---
  #494 flow-verify-and-test
    下载: https://s3p.nuwax.com:9443/xxx.zip

--- MCP 配置 (0 个) ---
```

> 返回数据中 `skills` 列表使用 `SkillResultItemDTO`，含干净的 `downloadUrl` 字段。`download-skill.sh` 优先从此处获取下载链接。

**退出码：**

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 参数错误 |
| 2 | 环境变量缺失 |
| 3 | HTTP 请求失败 |
| 4 | 业务错误 |

---

### 7. 更新配置 — `scripts/update-config.sh`

更新智能体的系统提示词和开场白。**当用户要求修改系统提示词或开场白时，必须使用 `update-config.sh` 通过接口更新，不要仅本地修改文件。**

```bash
# 推荐：从 UTF-8 文件上传（含中文时长文本）
./scripts/update-config.sh --system-prompt-file "./prompts/flow.base.md"

# 短文本
./scripts/update-config.sh --opening-msg "欢迎使用智能开发助手！"

# 同时更新两个
./scripts/update-config.sh \
  --system-prompt-file "./prompts/flow.base.md" \
  --opening-msg-file "./welcome.txt"

# Python 不可用时（需 PATH 中有 uv）
./scripts/check-python.sh --install
```

**参数说明：**

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--system-prompt` | string | - | 新的系统提示词 |
| `--system-prompt-file` | path | - | 从文件读取系统提示词 |
| `--opening-msg` | string | - | 新的开场白 |
| `--opening-msg-file` | path | - | 从文件读取开场白 |

> 至少指定 `--system-prompt` / `--system-prompt-file` / `--opening-msg` / `--opening-msg-file` 之一。留空的字段不会被修改。

**退出码：**

| 码 | 含义 |
|----|------|
| 0 | 更新成功 |
| 1 | 参数错误 |
| 2 | 环境变量缺失 |
| 3 | HTTP 请求失败 |
| 4 | 业务错误 |

---

## 配置项参考

以下是智能体项目的配置结构（由 `get-config.sh` 返回）：

| 配置键 | 说明 | 值类型 |
|--------|------|--------|
| `systemPrompt` | 系统提示词 | string（支持多行） |
| `openingChatMsg` | 开场白/欢迎语 | string |
| `tools` | 已注册的工具列表 | `ToolSearchResultItemDTO[]` |
| `skills` | 已注册的技能列表（含 `downloadUrl`） | `SkillResultItemDTO[]` |
| `mcpConfigs` | MCP 配置列表 | `McpResultDTO[]` |

> 更多配置项参考 `references/config-items.md`。

---

## 常见工作流

### 工作流 A：工具采纳（搜索 → 注册 → 开发）

当决定使用某个搜索到的工具 API 时，必须按以下两步操作：

```
1. 注册工具（必须先注册才能调用）
   ./scripts/add-tool.sh --target-type "Plugin" --target-id 614

2. 根据工具的 schema 进行实际开发
   - 使用搜索结果中 schema 字段的接口定义（method, url, params 等）
   - 保持 schema 中的 ${...} 环境变量占位符，不硬编码
```

> ⚠️ **注册是调用前提**：搜索到的 Plugin、Workflow、Knowledge、Skill 必须先通过 `add-tool.sh` 注册才能调用。

### 工作流 B：开发前资源发现

```
1. 理解需求 → 列出需要的功能点
2. 对每个功能点执行 search-apis.sh → 确认是否有现成 API
3. 对每个领域问题执行 search-skills.sh → 确认是否有现成技能
4. 对确认使用的工具执行 add-tool.sh → 注册到项目
5. 汇总：已注册资源直接开发，缺失资源标记待开发
```

### 工作流 C：项目配置修改

```
1. 用户要求修改配置（如"把系统提示词改成XXX"）
2. 先执行 get-config.sh 查看当前配置（可选但推荐）
3. 将提示词写入 UTF-8 文件（如 prompts/flow.base.md），执行:
   update-config.sh --system-prompt-file prompts/flow.base.md
4. 再次执行 get-config.sh --key systemPrompt 确认中文未乱码
```

### 工作流 D：批量配置初始化

```
1. 整理所有需要配置的键值对
2. 逐项执行 update-config.sh（或准备配置文件用 --value-file）
3. 最后执行 get-config.sh（不带 --key）确认全量配置正确
```

---

## Anti-patterns

- ❌ **跳过注册直接调用**：搜索到工具后不执行 `add-tool.sh` 注册，直接尝试调用，导致调用失败。
- ❌ **绕过搜索直接造轮子**：开发新功能前不搜索是否有现成 API/技能，导致重复实现。
- ❌ **直接修改配置文件**：手动编辑项目配置文件而非使用配置接口更新，导致配置不同步或格式错误。
- ❌ **假设 API 存在**：不执行搜索就假设某个接口存在，直接编写调用代码。
- ❌ **替换环境变量占位符**：把搜索到的 API schema 中 `${PLATFORM_BASE_URL}`、`${SANDBOX_ACCESS_KEY}` 等占位符替换为实际值硬编码，导致代码不可移植。
- ❌ **把 API 地址/Token 硬编码**：在 SKILL.md 或脚本中硬编码接口地址，应通过环境变量注入。
- ❌ **python3 失败就改手写 curl**：应先 `check-python.sh --install`，仍用 `update-config.sh`
- ❌ **命令行内联多行中文**：应使用 `--system-prompt-file` 读 UTF-8 文件
- ❌ **忽略返回值**：执行配置更新后不检查返回的 `code`/`success` 字段，可能导致静默失败
- ✅ **先搜后用**：任何功能开发前，先用对应脚本检索平台已有资源。
- ✅ **配置走接口**：所有项目配置的读写统一通过 `get-config.sh` / `update-config.sh`（UTF-8 安全的 Python 实现）。
- ✅ **中文用文件上传**：长系统提示词用 `--system-prompt-file` 指向 UTF-8 文件
- ✅ **环境变量占位保留**：使用搜索到的 API 时，schema 中的 `${...}` 占位符保持原样，由运行时平台注入。
- ✅ **环境变量注入**：API 地址通过 `PLATFORM_BASE_URL`、认证通过 `SANDBOX_ACCESS_KEY`、空间 ID 通过 `DEV_SPACE_ID` 环境变量注入。
