# V1 Plan: DeepAgents ACP 应用 Agent Starter Repo

## Summary
V1 交付一个 JS/TS Starter Repo，用来生成具体场景的 ACP 应用 Agent。使用流程是：开发 Agent 基于用户需求生成项目，用户在清晰可改区手动修改，开发 Agent 走完整 ACP + 平台调试，通过后打包成可分发 Agent 包。

**核心框架**：使用 [deepagents](https://github.com/langchain-ai/deepagentsjs) JS（v1.10.2）作为 Agent 运行时，通过 `deepagents-acp`（v0.1.12）暴露 ACP stdio server，自定义工具通过 `@langchain/core/tools` 的 `tool()` 构建，与 deepagents 工具系统完全兼容。

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    nuwaclaw (ACP Client)                  │
│            connects via stdio ACP protocol                │
├──────────────────────────────────────────────────────────┤
│        DeepAgentsServer (deepagents-acp v0.1.12)         │
│  session mgmt / tool streaming / permissions              │
├──────────────────────────────────────────────────────────┤
│        createDeepAgent() (deepagents v1.10.2)            │
│  LangGraph runtime / middleware / subagents               │
├──────────────┬──────────────┬────────────────────────────┤
│  Built-in    │  Platform    │   Custom                   │
│  Tools       │  MCP Tools   │   Tools (tool() from       │
│  (deepagents)│  (via MCP)   │   @langchain/core/tools)   │
├──────────────┼──────────────┼────────────────────────────┤
│  FilesystemBackend │ Skills (SKILL.md) │ Memory files    │
├──────────────┴──────────────┴────────────────────────────┤
│              Platform Integration Layer                   │
│  PlatformClient / MCPManager / VariableManager            │
└──────────────────────────────────────────────────────────┘
```

### deepagents 框架使用方式

| deepagents API | 用途 | 对应文件 |
|---|---|---|
| `createDeepAgent()` | 创建 agent，组合 tools + skills + middleware + backend | `src/runtime/agent-factory.ts` |
| `FilesystemBackend` | 文件系统操作后端，rootDir 绑定 workspace | `src/runtime/agent-factory.ts` |
| `FilesystemPermission` | 文件权限控制（保护 src/runtime/） | `src/runtime/agent-factory.ts` |
| `DeepAgentsServer` | ACP 协议 server，管理 sessions 和 tool streaming | `src/runtime/acp-server.ts` |
| `DeepAgentConfig` | ACP agent 配置（extends CreateDeepAgentParams） | `src/runtime/acp-server.ts` |
| `tool()` from `@langchain/core/tools` | 自定义工具定义，与 deepagents 工具系统兼容 | `src/app/tools/*.tool.ts` |
| `skills` parameter | 渐进式 skills 加载（SKILL.md + YAML frontmatter） | `skills/builtin/`, `skills/platform/` |
| `memory` parameter | AGENTS.md / CLAUDE.md 自动加载到 system prompt | 工作区根目录 |

### 自定义工具（通过 `tool()` 构建）

| 工具 | 类型 | 说明 |
|---|---|---|
| `http_request` | 无状态 | 通用 HTTP 客户端 |
| `json_utils` | 无状态 | JSON 解析/校验/提取/合并 |
| `platform_api` | 绑定 PlatformClient | Nuwax 平台 API（savePrompt, queryPlugins 等） |
| `agent_variable` | 绑定 VariableManager | Agent 变量管理（API key 占位符） |
| `mcp_tool_bridge` | 绑定 MCPManager | MCP 工具发现和调用 |

### Editable Zones

| Zone | Who Edits | deepagents 权限 |
|---|---|---|
| `src/runtime/` | **Protected** | `FilesystemPermission: deny write` |
| `src/app/` | **AI + User** | `FilesystemPermission: allow` |
| `prompts/` | **AI + Platform** | allow |
| `skills/` | **AI + Platform** | allow |
| `config/` | **User + Platform** | allow |

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Agent framework | deepagents JS (LangGraph) | 官方 JS/TS 版本，batteries-included |
| ACP protocol | deepagents-acp DeepAgentsServer | 官方 ACP 包，stdio transport |
| Tool 定义 | `tool()` from @langchain/core/tools | 与 deepagents 工具系统完全兼容 |
| Skills | SKILL.md + YAML frontmatter | deepagents 原生 skills 参数加载 |
| Filesystem | FilesystemBackend | deepagents 原生 backend，rootDir 绑定 |
| Permissions | FilesystemPermission[] | deepagents 原生权限系统，deny/allow |
| Config priority | ACP/session startup config > env > config file > defaults | pydantic-deepagents CLI 模式 |
| Tool priority | Platform MCP > Built-in > deepagents > Write code | 用户要求 |
| Prompt source | ACP only | 用户要求，不硬编码 |
| Variable mgmt | AI 创建 → 用户填写 | 用户要求 |
| Distribution | npm/tgz/git via agent-package.json | 灵活分发 |

## Project Structure

```
src/
├── runtime/                    # Protected — infrastructure
│   ├── acp-server.ts          # DeepAgentsServer 启动 + config 组装
│   ├── agent-factory.ts       # createDeepAgent() + FilesystemBackend + tools
│   ├── config-loader.ts       # Config priority chain (Zod validated)
│   ├── platform-client.ts     # Nuwax API client
│   ├── mcp-manager.ts         # MCP merge (session > platform > defaults)
│   ├── variable-manager.ts    # Agent variable management
│   ├── logger.ts              # Structured logging
│   └── index.ts
├── app/                        # AI + User editable
│   ├── tools/                  # Custom tools (tool() from @langchain/core)
│   │   ├── index.ts           # createTools(ctx) — factory function
│   │   ├── http-request.tool.ts
│   │   ├── platform-api.tool.ts
│   │   ├── agent-variable.tool.ts
│   │   ├── mcp-bridge.tool.ts
│   │   ├── json-utils.tool.ts
│   │   └── _example.tool.ts
│   ├── subagents/
│   ├── adapters/
│   └── hooks/
└── index.ts                    # Entry point → bootstrap()

prompts/                        # Prompt templates
skills/
├── builtin/                    # 9 development skills (SKILL.md)
└── platform/                   # 6 platform skills (SKILL.md)
config/                         # JSON configs
tests/                          # vitest tests
scripts/                        # build/package/dev scripts
template.manifest.json          # Zone declarations
agent-package.json              # Distribution manifest
```

## Test Plan
- 单元测试：config-loader, mcp-manager, variable-manager, platform-client
- 工具测试：MCP bridge stdio call, platform endpoint routing, platform debug session create/status, platform-bound MCP hydration
- 图谱测试：generated-code node relationship graph
- Manifest 测试：agent-package/template manifest 的 nuwaclaw engine contract
- ACP smoke test：stdio initialize/session-new, agent config build, session prompt/model/MCP injection
- 构建验收：typecheck, lint, build, package
- 后续集成测试：nuwaclaw client 真实 ACP session → prompt → platform debug session

## Current Status
- ✅ Project scaffolding
- ✅ Runtime layer (acp-server, agent-factory, config-loader, platform-client, mcp-manager, variable-manager, logger)
- ✅ Custom tools (5 tools via tool())
- ✅ Skills (15 SKILL.md files)
- ✅ Prompts + template.manifest.json + agent-package.json
- ✅ TypeScript compiles clean (0 errors)
- ✅ Unit tests (config-loader, mcp-manager, variable-manager, platform-client)
- ✅ Tool tests (MCP bridge stdio call)
- ✅ Platform debug session tool/client tests (create + status)
- ✅ Platform-bound MCP components hydrate into MCPManager during ACP/CLI startup
- ✅ nuwaclaw engine integration contract doc + manifest contract tests
- ✅ Code graph generation for nuwaclaw UI (`npm run graph`)
- ✅ ACP stdio smoke tests (initialize + session/new without invoking LLM)
- ✅ ACP config smoke tests (session prompt/model/MCP startup injection)
- ✅ Package flow (`npm run package`) generates `.tgz` + `agent-package.release.json`
- ✅ npm/tgz/git distribution surfaces in `agent-package.json`
- ✅ Runtime verification (`node dist/index.js --help`)
- ⬜ Full nuwaclaw UI ACP prompt/debug integration test
- ⬜ Nuwax API production endpoint validation with real platform docs/environment

## Reference Notes

See `docs/template-capabilities.md` for:

- default built-in tools
- default built-in skills
- config-delivered capabilities
- `/Users/apple/workspace/pydantic-deepagents` reference evaluation
- current `deepagents-acp` startup-level session config boundary

See `docs/nuwaclaw-engine-integration.md` for the nuwaclaw package, ACP launch, startup config, MCP hydration, debug, and graph contracts.
