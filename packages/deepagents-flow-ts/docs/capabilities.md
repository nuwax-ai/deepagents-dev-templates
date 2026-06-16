# 能力分层与配置

`deepagents-flow-ts` 把 Agent 的每一项能力归入一个**来源层**，明确「谁能改、从哪来」。
这让 nuwax 平台面板、ACP 会话、环境变量、模板内置各司其职，互不越界。

## 来源层

| 层 | 来源 | 例子 | 面板可编辑 |
| --- | --- | --- | --- |
| `acp-dynamic` | ACP 会话 / nuwax 配置面板 / config | systemPrompt、mcpServers、skills、model、subagents | ✅ |
| `agent-builtin` | 模板包内置 | bash / 文件读写 / search / http / json / mcp-bridge / platform_api / agent_variable / load_skill / task / compaction / demo | ❌（改源码） |
| `env-builtin` | 环境变量 | API key、base URL、LOG_DIR | env |
| `agent-builtin-file` | 用户级会话目录（文件，无 DB） | sessionStore（默认 `~/.flowagents/<workspace 散列>/`，可经 `config.memory.dir` opt-out 回 `./.flow-sessions`） | ❌ |
| `package-placeholder` | 打包/安装时替换 | `${AGENT_ID}`、`${PACKAGE_VERSION}` | ❌ |

完整映射：[.nuwax-agent/capability-sources.json](../.nuwax-agent/capability-sources.json)；面板字段：[.nuwax-agent/panel.config.json](../.nuwax-agent/panel.config.json)。

## 查询

```bash
deepagents-flow-ts capabilities   # 无凭证，输出工具/MCP/skills/能力分层
deepagents-flow-ts sessions       # 已持久化的会话
```

## 每项能力从哪进图

`FlowRuntime`（接口 [src/runtime/flow-runtime.ts](../src/runtime/flow-runtime.ts)，装配工厂 `createFlowRuntime` 见 [src/compose/flow-runtime.ts](../src/compose/flow-runtime.ts)）在启动时把各层组装成一处，注入图节点：

- **systemPrompt** — `resolveSystemPrompt`，优先级 ACP session > `config.agent.systemPrompt` > `prompts/flow.base.md` > inline fallback。
- **mcpServers** — 三层合并（`config/mcp.default.json` < 平台绑定 MCP < ACP/session MCP，`session-wins`），native 工具经 `@langchain/mcp-adapters`（`MultiServerMCPClient`）由 runtime-context 加载（已不再用 `MCPManager`）。
- **model** — `resolveModel`（ACP session > env > config > 默认）。
- **skills** — `discoverSkills` 发现 `skills/builtin/`、`skills/platform/`、`.agents/*/skills/` 下的 SKILL.md；其 name/description 经 `renderSkillsSection` 注入系统提示词，模型用 `load_skill(name)` 渐进式读完整正文（deepagents progressive disclosure）。
- **subagents** — `discoverSubAgents` 解析 `.agents/agents/<name>/AGENT.md`（frontmatter 可选 `model`/`tools`/`workdir`；`model` 可写模型名或 `openai/<model>` / `anthropic/<model>`）；默认 ReAct 图经 `task({ subagent_type, description })` 委派（子代理复用默认图、独立 prompt/工具/工作目录，默认继承父 cwd）。自定义图也可直接用 subgraph（见 [examples/dev-agent/researcher.ts](../examples/dev-agent/researcher.ts)）。
- **builtInTools** — `createFlowTools(ctx)` 组装（内置通用 http/json/platform_api/agent_variable + flow 自补 bash/fs/search/mcp-bridge + `load_skill`/`task` + native MCP + demo，全在 `src/app/tools/`），`bindTools` 绑给模型、`ToolNode` 执行。
- **compaction** — [src/app/compaction.ts](../src/app/compaction.ts)，消费 `config.compaction`。
- **sessionStore** — `FileCheckpointSaver`（继承 `MemorySaver`），默认持久化到 `~/.flowagents/<workspace 散列>/`（`resolveSessionDir` 按 workspace 隔离）；设 `config.memory.dir` 为相对路径可 opt-out 回项目内。CLI：`sessions` 列出、`sessions delete <id>` 删除。

## 扩展（不改源码）

- **加 MCP**：编辑 `config/mcp.default.json`，或经平台面板下发 `ACP_SESSION_CONFIG_JSON.mcpServers`。常用 server 见 [config/mcp.examples.json](../config/mcp.examples.json)（context7 / chrome-devtools / filesystem / bash / duckduckgo）。
- **加 Skill**：放 `skills/builtin/<name>/SKILL.md`（YAML frontmatter `name`/`description` + 正文）。自动发现。
- **加 Subagent**：放 `.agents/agents/<name>/AGENT.md`（frontmatter `name`/`description`，可选 `model`/`tools`/`workdir`；`model` 可写同 provider 模型名，也可写 `openai/<model>` / `anthropic/<model>`；正文=systemPrompt）。默认图自动暴露为 `task` 委派工具；自定义图可用 subgraph（见 [examples/dev-agent/researcher.ts](../examples/dev-agent/researcher.ts)）。
- **改系统提示词**：编辑 `prompts/flow.base.md`，或经 ACP session / `config.agent.systemPrompt`。
- **换模型**：改 `config.model` 或设 `ANTHROPIC_MODEL` / `OPENAI_MODEL`。

## 给目标 Agent 的工具优先级

需要外部能力时按序判断：① MCP 工具（`mcp_tool_bridge list_tools` 发现）→ ② 内置工具（bash/读写/search/http）→ ③ 平台工具（platform_api/agent_variable）→ ④ 自写代码（最后）。
