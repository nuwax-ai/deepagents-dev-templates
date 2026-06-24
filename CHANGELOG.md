# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- CI workflow references `packages/template` → `packages/deepagents-app-ts`
- Unified package manager to pnpm (added pnpm-lock.yaml, updated CI)

### Added
- `scripts/pack-template.js` for TS/Python zip packaging
- `AGENTS.md` symlink to `CLAUDE.md` in both templates
- `CONTRIBUTING.md` and `CHANGELOG.md`

## [v0.4.1] - 2025-06-09

### Changed
- TypeScript template version 0.4.1

## [v0.4.0] - 2025-06-03

### Added
- Python template package (`deepagents-app-py`) mirroring TS template
- Python CI workflow with ruff/pyright/pytest
- Python release workflow with package/publish scripts

### Changed
- Renamed `template` → `deepagents-app-ts`
- Renamed `template-python` → `deepagents-app-py`
- Restructured shared skills for TS/Python dual support

## [v0.3.9] - 2025-05-28

### Fixed
- Publish S3 script: define PKG_NAME to fix unbound variable

## [v0.3.8] - 2025-05-28

### Fixed
- Update workspace name in package-lock.json for npm ci compatibility

## [v0.3.7] - 2025-05-27

### Fixed
- Release workflow working-directory for new package path

## [v0.3.6] - 2025-05-27

### Added
- Agent core package lifecycle documentation
- Runtime storage config improvements

## [v0.3.5] - 2025-05-26

### Added
- Compaction and eviction middleware
- Protected paths middleware
- OpenAI-compatible provider support

## [v0.3.4] - 2025-05-25

### Added
- Slash commands system
- Platform client improvements

## [v0.3.3] - 2025-05-24

### Added
- MCP manager improvements
- Variable manager enhancements

## [v0.3.2] - 2025-05-23

### Added
- Inspector package with read-only visualization
- Browser UI for agent orchestration

## [v0.3.1] - 2025-05-22

### Added
- Dev agent configuration and skills
- System prompt templates

## [v0.3.0] - 2025-05-21

### Added
- ACP server implementation
- CLI surfaces (REPL, one-shot)
- Config loader with 6-layer priority chain
- Middleware chain (lifecycle, cost tracking, stuck loop, eviction)

## [v0.2.10] - 2025-05-20

### Added
- Agent package configuration
- Distribution scripts (package, publish S3)
- Platform integration

## [v0.2.9] - 2025-05-19

### Added
- Tools: http_request, platform_api, agent_variable, mcp_bridge
- Skills system with YAML frontmatter

## [v0.2.8] - 2025-05-18

### Added
- Code graph generation
- Template manifest

## [v0.2.7] - 2025-05-17

### Added
- Model provider abstraction (Anthropic, OpenAI, Google)
- Permission modes (ask, yolo, plan)

## [v0.2.6] - 2025-05-16

### Added
- Config schema with Pydantic models
- Environment variable mapping

## [v0.2.5] - 2025-05-15

### Added
- Prompt management system
- System prompt assembly

## [v0.2.4] - 2025-05-14

### Added
- Storage layer (harness lifecycle, approvals)
- Logger with file tee

## [v0.2.3] - 2025-05-13

### Added
- Discovery system (skills, memory, sub-agents)
- Helpers utilities

## [v0.2.2] - 2025-05-12

### Added
- Platform integration (MCP, variables)
- Session management

## [v0.2.1] - 2025-05-11

### Added
- Initial project structure
- Basic agent framework

## [v0.2.0] - 2025-05-10

### Added
- Initial release
- TypeScript template foundation

---

## Flow TypeScript Template Versions

`packages/deepagents-flow-ts` — LangGraph 工作流编排模板（显式节点图，非 tool loop）。

### [flow-ts-v1.0.1] - 2026-06-24

#### Fixed
- **http_request SSRF 防护**：拦截私有/loopback/链路本地/元数据端点；redirect 手动限跳并逐跳重校验；响应体流式字节上限防 OOM
- **Sandbox 符号链接逃逸**：写路径经 realpath 解析后再校验
- **Checkpoint 原子写**（tmp+rename）+ 损坏文件 `corrupted` 短路，避免每 graph step 重复刷 warn
- ACP `tool_update` 携带工具名（修复客户端显示 toolCallId 而非工具名）
- vendored ACP `stop()` 先 `closeSession` 释放 MCP stdio 子进程
- `think.ts` Anthropic 缓存断点、`task.tool.ts` parentCallbacks 作用域、`llm-resilience` usage 诊断

#### Changed
- `compaction` 下沉 `src/libs/`（修复 surfaces→app 分层倒挂）
- 删除 `agent-dev-config`，与 `dev-agent-flow` 解耦

#### Added
- `tests/security.test.ts`：sandbox symlink 逃逸 + http SSRF 回归

### [flow-ts-v1.0.0] - 2026-06-23

#### Added
- **adaptive-rag 拓扑**（对齐官方 Adaptive RAG）
- **conversational StatefulFlow**：多轮记忆；RAG recipe 迁移至拓扑积木
- **Task subagent 流式委派**：独立 `messageId`、生命周期阶段事件、`STREAM_TEXT_NODES` 白名单；结构化 `onToken source`
- **Native MCP** 主路径；`createStatefulFlow` 作为有状态 flow 统一入口
- **7 拓扑 scaffold** + `libs/topologies/` 积木化（react-tools / human-in-loop / project-manager / travel-planner / rag / adaptive-rag / deep-research / dev-agent + custom）
- 节点 factory：`createLlmRouterNode`、`createMcpRetrievalNode`、`createApprovalFinalizeNode`
- Flow 注册表（`src/app/flows/`）+ scaffold 示例 flow（knowledge-qa、trip-planner、project-planner 等）
- **Session trace 日志**（surface 层集中，锚定 ACP onPrompt 周期）
- `docs/node-catalog.md`；MCP 示例与 capability-discovery 技能刷新

#### Changed
- 版本号 **0.2.0 → 1.0.0**，同步 `flow-agent.config.json`、`.nuwax-agent/agent-package.json` 等发布元数据
- 路径统一 `FLOWAGENTS_DIRNAME`（`~/.flowagents`），移除 `.deepagents`
- 预设拓扑迁移至共享 node factory；统一子智能体术语
- 移除 runtime platform client，能力改走 ACP
- Bootstrap 日志并入 session 文件

#### Fixed
- ACP 系统提示词未加载；解析 `nuwaclaw _meta.systemPrompt.append`；ACP 会话配置迁移至 surfaces
- cancel 不生效（与 0.2.0 后续补丁合并验证）
- MCP 默认配置从 package root 解析（非 ACP workspace cwd）
- `promptMs` 在 `flow.run` done 时刷新
- 打包 `bestzip` Node fallback（zip 归档）

### [flow-ts-v0.2.0] - 2026-06-17

#### Added
- **五层架构**：`core → runtime → libs → app → surfaces`，`tests/layering.test.ts` 强制分层
- **自包含 runtime**：去除 `deepagents-app-ts` 依赖；MCP 经 `@langchain/mcp-adapters` 原生化
- **Vendored deepagents-acp** 0.1.3；`FlowExecutor` onPrompt 短路
- **ACP cancel 全链路**：`StopReason::Cancelled`、in-flight `tool_call` failed update、`load_session`/`cancel`/`resume` 测试
- `mapStreamChunk` 流式事件映射（ToolNode 三态）
- 节点 factory 单测；`libs/nodes/` factory 体系初版
- deep-research：Context7 + DuckDuckGo 并行检索取优；LangGraph 框架优先编排

#### Changed
- 数据根统一 `~/.flowagents` + nuwaclaw per-session 日志 + 用户级配置层
- 移除 `@ts-nocheck`；ACP SDK 类型对齐
- 日志文件名日期改用下划线；bootstrap 去掉 `process` 前缀
- 收紧 stdio MCP 客户端生命周期（后续 1.0.0 继续加固）

#### Fixed
- MCP 非法配置容错；LLM 流式绕过 10 分钟限制；cwd 诊断
- deep-research `routeAfterQualityReview` 与图 `ends` 对齐（消除 approve 死值）
- 发布包排除 `.flow-sessions`；`package:platforms` AGENTS.md 符号链接 ENOENT
- 版本同步脚本 + 打包 `fs/promise` 调用

### [flow-ts-v0.1.0] - 2026-06-12

#### Added
- 从 RAG 工作流抽离为独立包 `deepagents-flow-ts`（通用 flow 模板）
- 默认 ReAct flow + 拓扑导出（`pnpm graph`）+ CI / vitest
- **StatefulFlow** 接缝（HITL）+ `createStatefulFlow` 长任务基座
- 6 个参考范例：`examples/rag`、`travel-planner`、`project-manager`、`human-in-loop`、`dev-agent`、`deep-research`
- `FlowRuntime` + 文件 checkpointer + 能力分层查询
- Skills / Subagent / compaction；dev-agent 开发模板收尾
- 跨平台路径 + 可选 ripgrep 搜索；跨平台打包脚本

#### Fixed
- sandbox / 持久化 / 压缩 / 健壮性 code-review 修复
- RAG 范例可调试性恢复；examples 真实接入 LLM + MCP

---

## Python Template Versions

### [python-v0.2.11] - 2025-06-09

#### Changed
- Migrated from pydantic-ai to LangGraph + deepagents
- Ported app tools to LangChain `@tool` decorators
- Rebuilt runtime engine on LangGraph state graphs
- ACP server on deepagents-acp (stdio transport)

#### Removed
- deepagents-acp-py standalone library
- pydantic-ai dependencies

### [python-v0.2.10] - 2025-06-03

#### Added
- Initial Python template package
- CLI surfaces (REPL, one-shot)
- ACP server stub
- Config system with Pydantic models
- Tools: http_request, platform_api, agent_variable, mcp_bridge, json_utils, runtime_info, agent_memory

---

[Unreleased]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.4.1...HEAD
[v0.4.1]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.4.0...v0.4.1
[v0.4.0]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.9...v0.4.0
[v0.3.9]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.8...v0.3.9
[v0.3.8]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.7...v0.3.8
[v0.3.7]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.6...v0.3.7
[v0.3.6]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.5...v0.3.6
[v0.3.5]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.4...v0.3.5
[v0.3.4]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.3...v0.3.4
[v0.3.3]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.2...v0.3.3
[v0.3.2]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.1...v0.3.2
[v0.3.1]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.3.0...v0.3.1
[v0.3.0]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.10...v0.3.0
[v0.2.10]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.9...v0.2.10
[v0.2.9]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.8...v0.2.9
[v0.2.8]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.7...v0.2.8
[v0.2.7]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.6...v0.2.7
[v0.2.6]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.5...v0.2.6
[v0.2.5]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.4...v0.2.5
[v0.2.4]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.3...v0.2.4
[v0.2.3]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.2...v0.2.3
[v0.2.2]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.1...v0.2.2
[v0.2.1]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/v0.2.0...v0.2.1
[v0.2.0]: https://github.com/nuwax-ai/deepagents-dev-templates/releases/tag/v0.2.0
[flow-ts-v1.0.1]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/flow-ts-v1.0.0...flow-ts-v1.0.1
[flow-ts-v1.0.0]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/flow-ts-v0.2.0...flow-ts-v1.0.0
[flow-ts-v0.2.0]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/flow-ts-v0.1.0...flow-ts-v0.2.0
[flow-ts-v0.1.0]: https://github.com/nuwax-ai/deepagents-dev-templates/releases/tag/flow-ts-v0.1.0
[python-v0.2.11]: https://github.com/nuwax-ai/deepagents-dev-templates/compare/python-v0.2.10...python-v0.2.11
[python-v0.2.10]: https://github.com/nuwax-ai/deepagents-dev-templates/releases/tag/python-v0.2.10
