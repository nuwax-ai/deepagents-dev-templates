# 能力分层与配置

`deepagents-flow-ts` 把本工作目录内 Agent 的每一项能力归入一个**来源层**，明确「谁能改、从哪来」。
项目内配置文件、环境变量、模板内置各司其职。

## 来源层

| 层 | 来源 | 例子 | 可编辑 |
| --- | --- | --- | --- |
| `workspace-config` | 项目内配置文件 | systemPrompt、mcpServers、skills、model、subagents | ✅（改 `config/` / `prompts/` / `builtin/` / `.agents/`） |
| `agent-builtin` | 模板包内置 | bash / 文件读写 / search / http / json / load_skill / task / compaction / demo（native MCP 见下） | ❌（改 `src/` 源码） |
| `env-builtin` | 环境变量 | API key、base URL、`LOG_LEVEL`、`LOG_DIR` | env / `.env` |
| `agent-builtin-file` | 用户级会话目录（文件，无 DB） | sessionStore（默认 `~/.flowagents/sessions/<workspace 散列>/`，可经 `config.memory.dir` opt-out 回 `./.flow-sessions`） | ❌ |
| `package-placeholder` | 打包/安装时替换 | `${INSTALL_ROOT}`、`${PACKAGE_VERSION}` | ❌ |

完整映射：[.nuwax-agent/capability-sources.json](../.nuwax-agent/capability-sources.json)（制品元数据）。

## 查询

在本仓库根目录执行：

```bash
pnpm exec tsx src/index.ts capabilities   # 无凭证，输出工具/MCP/skills/能力分层
pnpm exec tsx src/index.ts sessions       # 已持久化的会话
```

## 每项能力从哪进图

`FlowRuntime`（接口 [src/runtime/flow-runtime.ts](../src/runtime/flow-runtime.ts)，装配工厂 `createFlowRuntime` 见 [src/index.ts](../src/index.ts)）在启动时把各层组装成一处，注入图节点：

- **systemPrompt** — `resolveSystemPrompt`：`config.agent.systemPrompt` / `prompts/flow.base.md` > inline fallback。ACP host 在 `session/new` 注入时可临时覆盖。
- **mcpServers** — `config/mcp.default.json`（`config.mcp.configPath`）；native 工具经 `@langchain/mcp-adapters`（`MultiServerMCPClient`）由 runtime-context 加载，支持 **stdio / Streamable HTTP / SSE**（有 url 时默认 Streamable HTTP，`automaticSSEFallback` 失败后再试 SSE；连接成功与否以 **tools/list** 为准，session 结束 `destroyRuntimeContext` 关闭连接）。ACP session 可合并追加（`session-wins`），日常扩展改 `config/mcp.default.json` 即可。
- **model** — `resolveModel`（env > `config.model` > 默认）。协议优先级：`API_PROTOCOL` > `LLM_PROVIDER` > 凭证启发式 > `config.model.provider`（`anthropic` | `openai`）。
- **skills** — `discoverSkills` 发现 `agentsDirectories` 下各 `<root>/skills/`（默认含 `builtin/skills/`、`.agents/skills/`）及 `config.skills.directories` 的 SKILL.md；经 `renderSkillsSection` 注入清单，模型用 `load_skill(name)` 渐进式读正文。
- **subagents** — `discoverSubAgents` 发现 `agentsDirectories` 下各 `<root>/agents/`（默认含 `builtin/agents/`、`.agents/agents/`）；默认 ReAct 图经 `task({ subagent_type, description })` 委派。自定义图可用 subgraph（见 [examples/dev-agent/researcher.ts](../examples/dev-agent/researcher.ts)）。
- **builtInTools** — `createFlowTools(ctx)`（[src/app/flow-tools.ts](../src/app/flow-tools.ts)）组装 http/json + bash/fs/search + `load_skill`/`task` + native MCP + demo，`bindTools` 绑给模型、`ToolNode` 执行。`http_request` 默认拦截私有/loopback/链路本地/云元数据端点（防 SSRF）+ 响应字节上限（防 OOM）；需访问内网改用 `createHttpRequestTool({ allowPrivateNetwork: true })`。
- **compaction** — [src/libs/compaction.ts](../src/libs/compaction.ts)，消费 `config.compaction`。
- **sessionStore** — `FileCheckpointSaver`（继承 `MemorySaver`），默认持久化到 `~/.flowagents/<workspace 散列>/`（`resolveSessionDir` 按 workspace 隔离）；设 `config.memory.dir` 为相对路径可 opt-out 回项目内。CLI：`sessions` 列出、`sessions delete <id>` 删除。

## 扩展（不改 `src/libs/` 保护区）

- **加 MCP**：编辑 `config/mcp.default.json`。常用 server 见 [config/mcp.examples.json](../config/mcp.examples.json)（context7 / chrome-devtools / filesystem / bash），复制到 `servers` 即可。
- **加 Skill**：
  - **项目内置（推荐）**：`builtin/skills/<name>/SKILL.md`（`agentsDirectories` 含 `./builtin`）。
  - **工作区扩展**：`.agents/skills/<name>/SKILL.md`，或在 `config.skills.directories` 增加目录。
- **加 Subagent**：
  - **项目内置**：`builtin/agents/<name>/AGENT.md`。
  - **工作区扩展**：`.agents/agents/<name>/AGENT.md`。
  - **代码级复用** → subgraph（见 [examples/dev-agent/researcher.ts](../examples/dev-agent/researcher.ts)）。
- **改系统提示词**：编辑 `prompts/flow.base.md`，或设 `config.agent.systemPrompt` / `config.agent.systemPromptPath`。
- **换模型**：改 `config.model` 或设 `ANTHROPIC_MODEL` / `OPENAI_MODEL`（见 [`.env.example`](../.env.example)）。
- **换协议**：设 `API_PROTOCOL=anthropic|openai`，或 `LLM_PROVIDER`（同义别名）。`loadConfig` 会打 `platformModelEnv` / `resolveModelProvider` 诊断日志（密钥脱敏）；未替换的 `{MODEL_PROVIDER_*}` 占位符会 `warn`。

## 工具接入优先级

在本仓库内扩展业务能力时，按下列顺序判断（扩展方式见上文 [扩展（不改 src/libs/ 保护区）](#扩展不改-srclibs-保护区)）：

1. **MCP** — `config/mcp.default.json` + ACP session 合并的 `mcpServers`（运行时 native 加载，session 关闭自动销毁连接）
2. **内置 `libs/tools`** — bash / 读写 / search / http / json / load_skill / task / demo
3. **自写 `src/app/`** — 最后手段，在 [flow-tools.ts](../src/app/flow-tools.ts) 注册

密钥用环境变量或 `.env`，禁止硬编码。
