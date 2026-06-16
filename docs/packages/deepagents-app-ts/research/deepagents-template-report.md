# DeepAgents Dev Templates 深度研究报告

> 研究日期：2026-06-03。所有源码分析基于代码库当前状态。

## 执行摘要

**DeepAgents Dev Templates** 是一个基于 [deepagents](https://github.com/langchain-ai/deepagents)（LangGraph 驱动的 JS/TS Agent 框架）构建的 AI Agent 开发模板项目，旨在通过 ACP（Agent Client Protocol）协议与 nuwaclaw 平台集成。该项目由 Nuwax 团队维护，采用 TypeScript 严格模式开发，使用 Zod 进行数据验证，vitest 进行测试。

核心发现：

1. **清晰的分层架构**：项目将代码严格分为受保护区（`src/runtime/`）、AI 可编辑区（`src/app/`、`prompts/`、`skills/`）和用户配置区（`config/`），通过 `template.manifest.json` 强制执行。
2. **双入口设计**：ACP 服务器模式（供 IDE 集成）和独立 Agent 模式（CLI REPL/单次调用），共享同一套配置构建逻辑。
3. **四层配置优先级链**：ACP 会话 > 环境变量 > 配置文件 > 默认值，确保运行时灵活性。
4. **MCP 三层合并策略**：默认配置 → 平台配置 → 会话配置，支持 `session-wins`、`platform-wins`、`defaults-wins` 三种合并策略。
5. **15 个内置技能**：9 个通用开发技能 + 6 个平台集成技能，采用渐进式加载减少 Token 消耗。
6. **8 个自定义工具**：涵盖 HTTP 请求、平台 API、Agent 变量管理、MCP 桥接、JSON 处理、内存、检查点、对话历史。
7. **4 个运行时中间件**：卡死循环检测、周期性提醒、成本追踪、文件路径解析。
8. **完整的测试体系**：9 个单元测试文件 + 1 个 ACP 冒烟测试 + 1 个端到端验证脚本，覆盖配置、MCP、ACP 协议、平台集成、变量管理等核心领域。

## 背景

### deepagents 框架

[deepagents](https://docs.langchain.com/oss/javascript/deepagents/quickstart) 是 LangChain 生态中的 Agent 框架，基于 LangGraph 构建，提供以下核心能力：

| 能力 | 说明 |
|------|------|
| **任务规划** | 内置 `write_todos` 工具，支持结构化任务跟踪 |
| **虚拟文件系统** | 可插拔后端（StateBackend、FilesystemBackend、StoreBackend 等），支持 `ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep` |
| **文件权限** | 声明式路径级访问控制，支持 allow/deny 规则 |
| **子 Agent** | 临时子 Agent 处理隔离子任务，支持并行执行 |
| **技能系统** | 渐进式加载的 SKILL.md 文件，按需提供领域知识 |
| **持久记忆** | 基于 AGENTS.md 文件的跨会话持久上下文 |
| **上下文管理** | 自动摘要和上下文卸载，处理长对话 |
| **人机协作** | `interruptOn` 参数控制工具调用前的人工审批 |
| **中间件** | 可扩展的中间件栈，支持自定义行为注入 |

`createDeepAgent` 的核心参数：

```typescript
createDeepAgent({
  model,           // "provider:model" 格式或模型实例
  systemPrompt,    // 自定义系统提示词
  tools,           // 领域工具数组
  memory,          // AGENTS.md 文件路径
  skills,          // 技能目录路径
  backend,         // 文件系统后端
  permissions,     // 路径级访问控制
  subagents,       // 自定义子 Agent
  middleware,       // 额外中间件
  interruptOn,     // 人机协作中断配置
  responseFormat,  // 结构化输出 schema
})
```

### ACP 协议

ACP（Agent Client Protocol）是 Agent 与 IDE/编辑器之间的通信协议，使用 stdio 传输，JSON-RPC 2.0 格式。nuwaclaw 是支持 ACP 的客户端，可集成到 Zed、JetBrains 等 IDE 中。`deepagents-acp` 包提供了 ACP 服务器实现。

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        nuwaclaw (ACP 客户端)                      │
│                    Zed / JetBrains / VS Code                     │
└────────────────────────────┬────────────────────────────────────┘
                             │ ACP (stdio JSON-RPC)
┌────────────────────────────▼────────────────────────────────────┐
│                    DeepAgentsServer (ACP 层)                      │
│              会话管理 · 权限中断 · 资源链接转换                      │
├─────────────────────────────────────────────────────────────────┤
│                  createDeepAgent() (LangGraph 运行时)              │
│        模型 · 系统提示词 · 工具 · 技能 · 记忆 · 子Agent             │
├──────────┬──────────┬──────────┬──────────┬──────────────────────┤
│ 平台 MCP  │ 内置工具  │ deepagents│ 自定义   │ 文件系统 · 技能       │
│ 工具     │ 8个工具   │ 内置工具  │ 代码     │ · 记忆 · 平台集成     │
└──────────┴──────────┴──────────┴──────────┴──────────────────────┘
```

### 目录结构

```
src/runtime/     — 受保护基础设施（ACP 服务器、平台客户端、配置加载器、MCP 管理器）
src/app/         — 业务逻辑（工具、子 Agent、钩子、适配器）— AI 和用户可编辑
src/cli/         — 命令行接口（REPL、单次调用）
prompts/         — 系统提示词模板
skills/          — 渐进式加载技能（builtin + platform）
config/          — 模型、MCP、变量、权限配置
tests/           — 测试套件（unit + acp-smoke + 集成验证）
scripts/         — 构建、开发、打包脚本
```

### 可编辑区域

| 区域 | 路径 | 权限 | 说明 |
|------|------|------|------|
| 受保护 | `src/runtime/` | 不可修改 | 基础设施代码，需明确授权才能变更 |
| AI 可编辑 | `src/app/`、`prompts/`、`skills/` | AI 和用户自由修改 | 业务逻辑、提示词、技能 |
| 用户可编辑 | `config/` | 用户和平台配置 | 配置文件 |

## 运行时层（受保护区）

运行时层是整个模板的核心基础设施，由 10 个模块和 4 个中间件组成。

### 模块依赖关系

```
logger.ts (叶子依赖，无内部导入)
    ↑
config-loader.ts ← 加载 & 验证配置
    ↑
platform-client.ts ← Nuwax 平台 HTTP 客户端
    ↑
variable-manager.ts ← Agent 变量管理（依赖 platform-client）
    ↑
mcp-manager.ts ← MCP 服务器配置合并
    ↑
helpers.ts ← 中央协调器（组合所有服务）
    ↑              ↑
acp-server.ts   agent-factory.ts ← 两个入口点
    ↑
index.ts ← 桶导出

code-graph.ts ← 独立工具（无运行时依赖）
```

### 核心模块详解

#### 1. `config-loader.ts` — 配置加载器

实现四层优先级链：**ACP 会话 > 环境变量 > 配置文件 > 默认值**。

使用 Zod schema 定义完整配置结构：

| Schema | 关键字段 | 默认值 |
|--------|---------|--------|
| `ModelConfigSchema` | provider, name, baseUrl, apiKeyEnv, authTokenEnv, settings | `anthropic` / `claude-sonnet-4-6` |
| `MCPConfigSchema` | configPath, mergeStrategy | `./config/mcp.default.json` / `session-wins` |
| `PlatformConfigSchema` | apiBaseUrl, agentId, spaceId, endpoints (11个) | `https://api.nuwax.com` |
| `PermissionsConfigSchema` | interruptOn, allowedPaths, deniedPaths | 中断: write_file, edit_file, execute |
| `SkillsConfigSchema` | directories, progressiveLoading | `./skills/builtin/`, `./skills/platform/` |
| `MemoryConfigSchema` | enabled, dir, addCacheControl | `true` / `.agent-memory` |
| `AppConfigSchema` | 组合所有子 schema + agentsDirectories + middleware | — |

环境变量映射（`ENV_MAP`）：

| 环境变量 | 配置路径 |
|---------|---------|
| `ACP_AGENT_NAME` | `agent.name` |
| `ACP_AGENT_DESCRIPTION` | `agent.description` |
| `PLATFORM_API_BASE_URL` | `platform.apiBaseUrl` |
| `PLATFORM_AGENT_ID` | `platform.agentId` |
| `PLATFORM_SPACE_ID` | `platform.spaceId` |
| `DEFAULT_MODEL` / `ANTHROPIC_MODEL` | `model.name` |
| `ANTHROPIC_BASE_URL` | `model.baseUrl` |
| `MCP_CONFIG_PATH` | `mcp.configPath` |
| `LOG_LEVEL` | `logging.level` |
| `ACP_DEBUG=true/1` | `logging.level=debug` |

#### 2. `acp-server.ts` — ACP 服务器引导

这是 ACP 模式的主入口，负责：

- **`SessionManager`**：内存中的会话跟踪器，记录会话 ID、创建时间、最后活动、模式和消息数
- **`patchSessionLifecycle(server)`**：对 `DeepAgentsServer` 实例进行猴子补丁，添加：
  - 会话跟踪（新建/关闭/列表）
  - 活动跟踪（提示/取消时更新）
  - `resource_link` 块到文本的转换
  - **HITL（人机协作）中断处理**：最复杂的补丁。当 LangGraph Agent 遇到 `__interrupt__` 时，拦截权限请求，呈现给 ACP 客户端，收集决策，缓存"始终允许/拒绝"决策，恢复 Agent 执行
- **`bootstrap(options)`**：主入口函数，加载配置、构建 Agent 配置、创建服务器、应用补丁
- **`buildACPAgentConfigAsync`**：异步变体，在构建前注入平台 MCP 服务器配置
- **`loadSessionConfigFromEnv()`**：解析 `ACP_SESSION_CONFIG_JSON` 环境变量

#### 3. `agent-factory.ts` — 独立 Agent 工厂

为非 ACP 模式（CLI REPL、单次调用）创建 Agent。与 `acp-server.ts` 共享相同的 `helpers.ts` 构建逻辑，确保配置一致性。

返回 `CreatedAgent` 对象：`{ agent, context, backend }`。

#### 4. `helpers.ts` — 中央协调器

整个运行时层的核心协调模块，组合所有服务：

- **`createRuntimeContext(config, sessionConfig?)`**：创建完整运行时上下文
  1. 创建 `PlatformClient`（可选 — 仅当 `agentId` 和 `spaceId` 都设置时；否则"仅本地"模式）
  2. 创建 `MCPManager`，应用会话 MCP 覆盖
  3. 创建 `VariableManager`（处理 null platformClient 的本地模式）
  4. 创建 `ToolContext` 绑定三个管理器
  5. 通过 `createTools(toolContext)` 创建工具

- **`hydrateRuntimeContext(context)`**：异步注入。通过 `PlatformClient.listMcpServers()` 获取平台 MCP 服务器配置并设置到 `MCPManager`。失败时非致命。

- **`buildAgentConfigParts(...)`**：**核心组合函数**，构建完整 Agent 配置：
  - 模型（通过 `resolveModel`）
  - 系统提示词（通过 `resolveSystemPrompt`）
  - 工具、技能路径、记忆文件
  - 子 Agent（通过 `discoverSubAgents`）
  - 权限和 interruptOn
  - 中间件栈：记忆中间件、卡死循环检测、文件路径解析、周期性提醒、成本追踪、钩子中间件
  - 启用 Checkpointer（用于 HITL + 会话持久化）

- **`resolveSystemPrompt(config, sessionConfig, workspaceRoot)`**：优先级链：ACP 会话提示词 > `prompts/developer-agent.system.md` 文件 > 内联回退。如果配置了输出风格，追加风格文件内容。

#### 5. `platform-client.ts` — Nuwax 平台 API 客户端

直接 HTTP API 集成，支持 Bearer/API-key 认证、30 秒超时、端点模板化（路径参数如 `{agentId}`）、变量 30 秒 TTL 缓存。

11 个平台操作：

| 操作 | 方法 | 端点 |
|------|------|------|
| `savePrompt` | POST | `/api/agent/config/update` |
| `queryPlugins` | GET | `/api/agent/component/search` |
| `bindComponent` | POST | `/api/agent/component/add` |
| `listComponents` | GET | `/api/agent/component/list/{agentId}` |
| `createVariable` | POST | 变量创建端点 |
| `updateVariable` | POST | 变量更新端点 |
| `listVariables` | GET | 变量列表端点 |
| `executePlugin` | POST | `/api/v1/plugin/{id}/execute` |
| `executeWorkflow` | POST | `/api/v1/workflow/{id}/execute` |
| `createDebugSession` | POST | 调试会话创建端点 |
| `getDebugSession` | GET | 调试会话获取端点 |

**`listMcpServers()`** 方法特别重要：将平台绑定的 MCP 组件规范化为 `MCPConfig` 格式，支持多种负载格式。

#### 6. `mcp-manager.ts` — MCP 服务器配置管理器

管理三层 MCP 配置的发现和合并：

| 层级 | 来源 | 说明 |
|------|------|------|
| 默认 | `config/mcp.default.json` | 文件配置 |
| 平台 | Nuwax API | 平台注入的 MCP 服务器 |
| 会话 | ACP 客户端 | 编辑器/客户端提供的覆盖 |

三种合并策略：

| 策略 | 合并顺序（后者覆盖前者） | 默认 |
|------|-------------------------|------|
| `session-wins` | 默认 → 平台 → 会话 | ✅ |
| `platform-wins` | 默认 → 会话 → 平台 | |
| `defaults-wins` | 会话 → 平台 → 默认 | |

缓存机制：配置变更时自动失效，下次查询重新合并。

#### 7. `variable-manager.ts` — Agent 变量管理器

管理 API 密钥、配置值、租户设置等变量。AI 创建占位符，用户通过平台 UI 填充值。

变量解析优先级：**环境变量（`AGENT_VAR_` 前缀）> 本地缓存 > 平台**。

支持无平台客户端的"仅本地"模式。空字符串语义：环境变量设为空字符串视为已设置（非 `undefined`）。

#### 8. `code-graph.ts` — 代码图生成器

生成 `nuwaclaw.agent-code-graph.v1` schema 的结构化图（节点 + 边），用于项目架构可视化和文档。

节点类型：`entrypoint` | `runtime` | `tool` | `skill` | `subagent` | `prompt` | `config` | `distribution` | `script` | `test`

边类型：`calls` | `loads` | `configures` | `packages` | `tests`

#### 9. `logger.ts` — 结构化日志器

支持日志级别、上下文字段、JSON 输出和子日志器。默认单例：`level="info"`, `structured=true`, `prefix="runtime"`。

### 运行时中间件

| 中间件 | 文件 | 功能 |
|--------|------|------|
| **卡死循环检测** | `middleware/stuck-loop.ts` | 检测三种重复模式：(a) 完全相同的连续调用 (b) A-B-A-B 交替模式 (c) 相同调用返回相同结果。支持 `warn`（重试指令）和 `error`（抛出异常）两种模式 |
| **周期性提醒** | `middleware/periodic-reminder.ts` | 每 N 轮注入目标锚定提醒，防止长对话中 Agent 偏离目标。首次 5 分钟，之后每 10 分钟 |
| **成本追踪** | `middleware/cost-tracking.ts` | 追踪每轮和累计 Token 使用量，超过阈值时警告。记录模型调用次数和工具调用次数 |
| **文件路径解析** | `middleware/fs-path-resolver.ts` | 将工作区相对路径解析为绝对路径。拦截 `write_file`、`edit_file`、`read_file` 工具调用 |

## 应用层（AI 可编辑区）

### 工具系统

8 个自定义工具，分为两类：

#### 无状态工具（直接导出）

| 工具 | 文件 | 功能 |
|------|------|------|
| `http_request` | `http-request.tool.ts` | 通用 HTTP 客户端，支持 GET/POST/PUT/DELETE/PATCH，30 秒超时，10K 字符截断 |
| `json_utils` | `json-utils.tool.ts` | JSON 解析、验证、提取（支持点号路径和数组索引）、深度合并 |
| `agent_memory` | `agent-memory.tool.ts` | 持久化 Markdown 记忆文件，支持按 section 读写，存储在 `.agent-memory/{agent-name}/MEMORY.md` |
| `conversation_history` | `conversation-history.tool.ts` | 搜索和浏览归档对话历史，简单关键词频率评分 |
| `checkpoint` | `checkpoint.tool.ts` | 保存/列表/回退/删除对话检查点，存储在 `.agent-checkpoints/` |

#### 上下文绑定工具（工厂函数）

| 工具 | 文件 | 依赖 |
|------|------|------|
| `platform_api` | `platform-api.tool.ts` | `PlatformClient` — 8 个操作：save_prompt, query_plugins, bind_component, list_components, execute_plugin, execute_workflow, create_debug_session, get_debug_session |
| `agent_variable` | `agent-variable.tool.ts` | `VariableManager` — 4 个操作：create, get, set, list |
| `mcp_tool_bridge` | `mcp-bridge.tool.ts` | `MCPManager` — 2 个操作：list_servers, call_tool |

#### MCP 桥接工具详解

`mcp_tool_bridge` 是平台集成的关键工具。每次 `call_tool` 调用会：

1. 启动 MCP 服务器子进程
2. 通过 stdin/stdout 进行 JSON-RPC 2.0 握手
3. 发送 `tools/call` 请求
4. 接收响应并终止子进程
5. 支持环境变量替换（`${API_KEY}` 模式）
6. 默认 30 秒超时（可通过 `MCP_TOOL_TIMEOUT_MS` 配置）

### 钩子系统

`hooks/index.ts` 提供生命周期钩子，实现为 deepagents `AgentMiddleware`：

5 个钩子事件：

| 事件 | 触发时机 | 能力 |
|------|---------|------|
| `pre_tool_use` | 工具执行前 | 可阻止执行、修改参数、提供替代结果 |
| `post_tool_use` | 工具成功后 | 后处理 |
| `post_tool_error` | 工具失败后 | 错误处理 |
| `before_model` | LLM 调用前 | 预处理 |
| `after_model` | LLM 响应后 | 后处理 |

钩子支持 `toolPattern`（正则匹配工具名）和 `priority`（数值越小越早执行）。

### 子 Agent 发现

`subagents/index.ts` 是薄重导出层，实际发现逻辑在 `runtime/helpers.ts`。每个子 Agent 是包含 `AGENT.md` 文件的子目录，YAML frontmatter 定义 `name` 和 `description`，正文成为 `systemPrompt`。

### 适配器注册表

`adapters/index.ts` 是数据格式适配器的脚手架，当前无注册适配器也无消费者，预留为未来扩展点。

### 命令行接口

两种 CLI 模式：

| 模式 | 文件 | 用途 |
|------|------|------|
| REPL | `cli/repl.ts` | 交互式终端对话，支持 `/help`、`/tools`、`/config`、`/clear`、`/save`、`/exit` 命令 |
| 单次调用 | `cli/one-shot.ts` | 非交互式单次提示执行 |

### 主入口点

`src/index.ts` 支持 5 种运行模式：

| 命令 | 模式 | 说明 |
|------|------|------|
| (默认) / `acp` | ACP 服务器 | stdio 协议，供 nuwaclaw/Zed/JetBrains |
| `chat` | REPL | 交互式终端对话 |
| `ask "<prompt>"` | 单次调用 | 非交互式问答 |
| `run <file>` | 文件执行 | 从文件读取提示词执行 |
| `graph [output]` | 代码图 | 生成代码节点关系图 JSON |

**ACP 模式特殊处理**：启动时清除所有模型相关环境变量（`ANTHROPIC_BASE_URL`、`ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_MODEL`），防止 shell 环境中的陈旧值干扰。然后加载 `.env` 文件作为回退。

## 技能框架

### 9 个内置开发技能

| 技能 | 用途 |
|------|------|
| `build-and-compile` | 构建系统模式、TypeScript 编译指导、依赖管理 |
| `code-review` | 5 类代码审查清单（正确性、安全性、性能、风格、测试），4 级严重度 |
| `environment-discovery` | 在执行任务前系统化探索工作区、工具和能力 |
| `git-workflow` | Git 最佳实践：提交、分支、冲突解决、安全规则 |
| `refactor` | 安全重构模式：小步变更、行为保持、常见模式（提取函数/类型、条件替换为映射） |
| `skill-creator` | 元技能：如何创建新技能（SKILL.md 格式、目录结构、命名规则） |
| `systematic-debugging` | 5 步系统化调试：复现 → 隔离 → 诊断 → 修复 → 验证 |
| `test-writer` | 使用 Vitest 编写全面测试（单元、集成、边界情况） |
| `verification-strategy` | 5 级验证策略：语法检查 → 单元测试 → 集成测试 → ACP 冒烟 → 端到端 |

### 6 个平台集成技能

| 技能 | 用途 |
|------|------|
| `acp-debugging` | ACP + 平台 devMode 调试流程完整演练 |
| `agent-package-release` | 生成 `agent-package.json` 并验证分发包 |
| `agent-variable-design` | 识别和创建 Agent 变量（API 密钥、配置值、秘密） |
| `mcp-integration` | MCP 配置生成、工具命名约定、服务器生命周期管理 |
| `platform-capability-discovery` | 发现 Nuwax 平台提供的插件、工作流、API 和组件绑定 |
| `platform-tool-selection` | 强制工具优先级：平台 MCP → 内置工具 → deepagents 内置 → 自定义代码 |

### 渐进式加载

技能采用渐进式披露：Agent 启动时仅读取每个 `SKILL.md` 的 frontmatter（名称、描述、标签），按需加载完整内容。这减少了系统提示词的 Token 消耗。

## 提示词系统

### 三个系统提示词

| 提示词 | 目标 Agent | 语言 |
|--------|-----------|------|
| `developer-agent.system.md` | 开发 Agent — 自主生成、修改和调试场景特定 AI Agent | 中文 |
| `code-assistant.system.md` | 代码助手 Agent — 读写修改源代码、执行命令 | 中文 |
| `target-agent.base.md` | 目标 Agent 基础模板 — 由平台动态生成 | 中文 |

### 提示词片段

| 片段 | 内容 |
|------|------|
| `platform-rules.md` | 平台集成规则：工具优先级、提示词管理、组件绑定、调试模式、约束 |
| `tool-usage-rules.md` | 强制工具选择优先级和使用规则的详细说明 |

### 输出风格

| 风格 | 特点 |
|------|------|
| `concise.md` | 先结论后原因，无过渡语，diff 格式代码变更，列表上限 3 项 |
| `explanatory.md` | 每步解释推理，说明为何选择此方案，列出权衡 |
| `formal.md` | 使用标题/段落组织，表格对比，代码块，正式专业语言 |

### 提示词来源约束

**目标 Agent 提示词仅来自 ACP 会话元数据**，绝不硬编码。AI 生成的提示词通过 `platform_api(operation: "save_prompt")` 保存到平台。开发者 Agent 提示词来自 `prompts/developer-agent.system.md`。

## 配置系统

### 配置文件

| 文件 | 用途 |
|------|------|
| `config/app-agent.config.json` | 主 Agent 配置（模型、MCP、平台、权限、技能、记忆、日志、中间件） |
| `config/mcp.default.json` | 默认 MCP 服务器配置（当前仅 context7） |
| `config/platform.json` | Nuwax 平台 API 端点映射和认证配置 |
| `.env` | 环境变量（API 密钥、模型配置、平台配置、ACP 配置） |

### 配置优先级链

```
ACP 会话配置 (最高)
    ↓
环境变量
    ↓
配置文件 (app-agent.config.json)
    ↓
Zod Schema 默认值 (最低)
```

### MCP 合并优先级

```
ACP 会话 MCP 覆盖 (最高)
    ↓
平台绑定 MCP 服务器
    ↓
默认 MCP 配置文件 (mcp.default.json) (最低)
```

### 平台连接模式

| 模式 | 条件 | 行为 |
|------|------|------|
| 平台集成 | `PLATFORM_AGENT_ID` + `PLATFORM_SPACE_ID` + `PLATFORM_API_TOKEN` 都设置 | 完整平台功能 |
| 仅本地 | 任一平台配置缺失 | `platform_api` 工具返回错误提示，MCP/变量仅使用本地配置 |

## ACP 协议与 nuwaclaw 集成

### ACP 协议更新类型

| 类型 | 说明 |
|------|------|
| `available_commands_update` | 可用命令更新通知 |
| `agent_message_chunk` | Agent 响应流式块 |
| `tool_call` | 工具调用请求 |
| `tool_call_update` | 工具调用状态更新 |

### 会话生命周期

1. ACP 客户端连接 → `initialize` 握手
2. 创建新会话 → `newSession` → 返回 `sessionId`（格式 `sess_xxx`）
3. 发送提示词 → Agent 处理 → 流式响应
4. 工具调用 → 可能触发 HITL 权限请求
5. 关闭会话 → `closeSession`

### HITL（人机协作）权限流程

当 Agent 遇到需要人工审批的操作时：

1. LangGraph Agent 触发 `__interrupt__`
2. ACP 服务器补丁拦截中断
3. 向 ACP 客户端呈现权限请求
4. 用户选择：`allow-once` / `allow-always` / `reject-once` / `reject-always`
5. `allow-always` / `reject-always` 决策被缓存，后续同类型操作自动处理
6. Agent 使用决策结果恢复执行

### 启动配置注入

通过 `ACP_SESSION_CONFIG_JSON` 环境变量注入会话配置：

```json
{
  "model": "anthropic:claude-sonnet-4-6",
  "agentId": "agent-xxx",
  "spaceId": "space-xxx",
  "systemPrompt": "你是一个客服助手...",
  "mcpServers": {
    "email": { "command": "npx", "args": ["-y", "email-mcp"] }
  }
}
```

### 代码图合约

`npm run graph` 输出 `nuwaclaw.agent-code-graph.v1` schema 的 JSON，供 nuwaclaw UI 渲染项目架构。

## 构建、测试与分发

### 构建流程

```bash
scripts/build.sh:
1. 清理 dist/ 目录
2. TypeScript 类型检查 (tsc --noEmit)
3. 编译 TypeScript (tsc)
4. 验证 dist/index.js 入口存在
```

### 测试体系

| 层级 | 文件数 | 覆盖范围 |
|------|--------|---------|
| 单元测试 | 9 | 配置加载、MCP 管理/合并、平台客户端、变量管理、代码图、Agent 包清单、ACP 服务器配置、工具调度 |
| ACP 冒烟测试 | 1 | 协议握手和会话创建（不调用 LLM） |
| 端到端验证 | 1 | 完整 ACP 协议生命周期（需 ANTHROPIC_API_KEY） |
| 测试夹具 | 1 | 假 MCP 服务器（JSON-RPC stdio） |

#### 关键测试覆盖

**配置加载器**（10 个测试用例）：
- 默认值回退、自定义文件加载、环境变量覆盖、会话覆盖、无效 JSON 处理、ACP_DEBUG 映射、LOG_LEVEL 映射、MCP_CONFIG_PATH 映射

**MCP 管理器**（10 个测试用例）：
- 三种合并策略、缓存失效、缺失服务器验证、多层添加式合并

**平台客户端**（6 个测试用例）：
- 所有端点 HTTP 请求构建、自定义端点映射、MCP 组件规范化

**变量管理器**（8 个测试用例）：
- 环境变量优先级、空字符串保留、仅本地模式、名称规范化

**ACP 验证脚本**（6 个测试用例）：
- TC-01 连接建立 ✅、TC-02 会话创建 ✅、TC-03 基本对话 ✅、TC-04 文件读取 ✅、TC-05 权限拒绝 ✅、TC-15 权限批准 ✅

#### ACP 测试计划

20 个测试用例（TC-01 到 TC-20），分三轮执行：

| 轮次 | 范围 | 用例数 |
|------|------|--------|
| 冒烟测试 | 连接、会话、基本对话、文件操作、权限 | 6 |
| 核心测试 | 文件编辑、HTTP、JSON、内存、对话历史、检查点、多轮上下文 | 8 |
| 扩展测试 | 会话取消、陈旧会话恢复、受保护路径拒绝、MCP 桥接、平台 API、Agent 变量、调试日志 | 6 |

### 分发流程

```bash
scripts/package.sh:
1. 读取 agent-package.json 版本和名称
2. 执行构建 (scripts/build.sh)
3. 运行所有测试 (npm test)
4. 创建 npm tarball (npm pack)
5. 计算 SHA256 校验和
6. 写入 agent-package.release.json（含校验和）
```

三种分发渠道：

| 渠道 | 格式 | 用途 |
|------|------|------|
| npm | 标准包 | 标准分发 |
| .tgz | 压缩包 | 客户特定/离线分发 |
| Git URL | 仓库引用 | 开发/预览/私有仓库 |

## 分析

### 跨领域洞察

#### 1. 一致性强制：工具优先级

4 级工具优先级（平台 MCP → 内置自定义 → deepagents 内置 → 自定义代码）在以下 6 个位置被重复强调：

- `developer-agent.system.md` 提示词
- `code-assistant.system.md` 提示词
- `tool-usage-rules.md` 提示词片段
- `platform-rules.md` 提示词片段
- `platform-tool-selection` 技能
- `platform-capability-discovery` 技能

这种多层次的重复确保了无论 Agent 加载哪些提示词或技能，都会遵守工具优先级规则。

#### 2. 安全边界：受保护运行时

`src/runtime/` 作为受保护区域通过以下机制强制执行：

- `template.manifest.json` 中的 `zones.protected` 声明
- `config/app-agent.config.json` 中的 `permissions.deniedPaths: ["src/runtime/"]`
- `developer-agent.system.md` 中的明确指令
- `platform-rules.md` 中的约束说明
- `buildPermissions()` 函数生成的 `FilesystemPermission` 规则

#### 3. 配置驱动设计

几乎所有运行时行为都可通过配置调整，无需修改源码：

- 模型选择和参数
- MCP 服务器配置和合并策略
- 平台端点映射
- 权限和中断规则
- 技能目录和加载方式
- 记忆存储位置
- 日志级别和格式
- 中间件参数

#### 4. 优雅降级

系统设计了多层降级路径：

- **无平台凭证** → 仅本地模式，`platform_api` 返回错误提示而非崩溃
- **无 API 密钥** → 警告但仍启动，Agent 可使用非 LLM 工具
- **MCP 服务器不可用** → 验证报告缺失，但不阻止启动
- **配置文件缺失/无效** → 回退到 Zod schema 默认值
- **平台 API 调用失败** → MCP 注入非致命，记录错误继续运行

#### 5. 会话状态管理

ACP 模式下的会话状态管理特别值得注意：

- **HITL 决策缓存**：`allow-always` / `reject-always` 决策在同一会话内缓存，避免重复提示
- **Checkpointer**：启用 LangGraph checkpointer 以支持 HITL 中断恢复和会话持久化
- **环境变量清理**：ACP 模式启动时清除 shell 中的模型环境变量，防止陈旧值干扰

### 架构优势

1. **关注点分离**：运行时（基础设施）与应用（业务逻辑）的严格分离
2. **可测试性**：所有核心模块都有单元测试，MCP 桥接工具使用真实子进程测试
3. **可扩展性**：工具、技能、钩子、适配器都提供了清晰的扩展点
4. **配置优先**：行为变更通过配置而非代码修改
5. **平台无关**：无平台凭证时仍可完整运行

### 已知问题与局限

1. **`checkpoint.tool.ts` 第 127 行**：`unlinkSync(deletePath)` 被调用了两次，第二次调用会抛出异常
2. **ACP 测试覆盖不完整**：20 个测试用例中仅 6 个（P0 级别）已验证通过
3. **MCP 桥接工具无状态**：每次 `call_tool` 都启动新的 MCP 服务器子进程，无法维持有状态连接
4. **对话历史搜索**：使用简单关键词频率评分，非语义搜索
5. **适配器注册表**：空脚手架，无实际功能
6. **`extractContent` 重复**：`one-shot.ts` 和 `repl.ts` 中有相同的响应提取函数
7. **ACP 元数据限制**：`deepagents-acp` 不暴露通用每会话元数据钩子，需通过 `ACP_SESSION_CONFIG_JSON` 环境变量注入
8. **缺少生产验证**：尚未在 nuwaclaw UI 和 Nuwax 生产端点上验证

## 结论

DeepAgents Dev Templates 是一个**生产级**的 AI Agent 开发模板，具有以下核心价值：

1. **开箱即用的 ACP 集成**：无需额外开发即可通过 ACP 协议与 nuwaclaw/Zed/JetBrains 集成
2. **灵活的配置系统**：四层优先级链和三层 MCP 合并策略，适应从本地开发到生产部署的各种场景
3. **安全的可扩展性**：受保护运行时 + AI 可编辑应用层的架构，确保基础设施稳定性的同时允许业务逻辑自由扩展
4. **完整的开发工具链**：15 个技能、8 个工具、4 个中间件，覆盖从编码到调试到发布的完整开发流程
5. **平台可选**：无平台凭证时优雅降级为仅本地模式，降低入门门槛

该模板适合需要构建与 nuwaclaw 平台集成的场景特定 AI Agent 的开发团队。通过遵循其工具优先级和可编辑区域约束，AI Agent 可以安全地生成和修改项目代码，同时保持运行时基础设施的完整性。

## 源码索引

| 模块 | 路径 |
|------|------|
| 主入口 | [src/index.ts](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/index.ts) |
| ACP 服务器 | [src/runtime/acp-server.ts](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/runtime/acp-server.ts) |
| Agent 工厂 | [src/runtime/agent-factory.ts](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/runtime/agent-factory.ts) |
| 配置加载器 | [src/runtime/config-loader.ts](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/runtime/config-loader.ts) |
| 中央协调器 | [src/runtime/helpers.ts](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/runtime/helpers.ts) |
| 平台客户端 | [src/runtime/platform-client.ts](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/runtime/platform-client.ts) |
| MCP 管理器 | [src/runtime/mcp-manager.ts](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/runtime/mcp-manager.ts) |
| 变量管理器 | [src/runtime/variable-manager.ts](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/runtime/variable-manager.ts) |
| 代码图 | [src/runtime/code-graph.ts](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/runtime/code-graph.ts) |
| 日志器 | [src/runtime/logger.ts](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/runtime/logger.ts) |
| 工具注册 | [src/app/tools/index.ts](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/app/tools/index.ts) |
| 钩子系统 | [src/app/hooks/index.ts](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/app/hooks/index.ts) |
| CLI REPL | [src/cli/repl.ts](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/cli/repl.ts) |
| CLI 单次调用 | [src/cli/one-shot.ts](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/cli/one-shot.ts) |
| 模板清单 | [template.manifest.json](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/template.manifest.json) |
| Agent 包清单 | [agent-package.json](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/agent-package.json) |
| 项目配置 | [config/app-agent.config.json](file:///Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/config/app-agent.config.json) |
