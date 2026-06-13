# 能力分层与配置

`deepagents-flow-ts` 把 Agent 的每一项能力归入一个**来源层**，明确「谁能改、从哪来」。
这让 nuwax 平台面板、ACP 会话、环境变量、模板内置各司其职，互不越界。

## 来源层

| 层 | 来源 | 例子 | 面板可编辑 |
| --- | --- | --- | --- |
| `acp-dynamic` | ACP 会话 / nuwax 配置面板 / config | systemPrompt、mcpServers、skills、model、subagents | ✅ |
| `agent-builtin` | 模板包内置 | bash / 文件读写 / search / http / json / mcp-bridge / platform_api / agent_variable / compaction / demo | ❌（改源码） |
| `env-builtin` | 环境变量 | API key、base URL、LOG_DIR | env |
| `agent-builtin-file` | 模板会话目录（文件，无 DB） | sessionStore（`.flow-sessions/`） | ❌ |
| `package-placeholder` | 打包/安装时替换 | `${AGENT_ID}`、`${PACKAGE_VERSION}` | ❌ |

完整映射：[.nuwax-agent/capability-sources.json](../.nuwax-agent/capability-sources.json)；面板字段：[.nuwax-agent/panel.config.json](../.nuwax-agent/panel.config.json)。

## 查询

```bash
deepagents-flow-ts capabilities   # 无凭证，输出工具/MCP/skills/能力分层
deepagents-flow-ts sessions       # 已持久化的会话
```

## 每项能力从哪进图

`FlowRuntime`（[src/runtime/flow-runtime.ts](../src/runtime/flow-runtime.ts)）在启动时把各层组装成一处，注入图节点：

- **systemPrompt** — `resolveSystemPrompt`，优先级 ACP session > `config.agent.systemPrompt` > `prompts/flow.base.md` > inline fallback。
- **mcpServers** — `MCPManager` 三层合并（`config/mcp.default.json` < 平台绑定 MCP < ACP/session MCP，`mergeStrategy: session-wins`），native 工具由 `loadMcpTools` 加载。
- **model** — `resolveModel`（ACP session > env > config > 默认）。
- **skills** — `resolveSkillsPaths` 发现 `skills/builtin/`、`skills/platform/`、`.agents/*/skills/`。
- **subagents** — `discoverSubAgents` 解析 `.agents/agents/<name>/AGENT.md`；在图里用 subgraph 调用。
- **builtInTools** — `createFlowTools(ctx)` 组装（app-ts 通用 + flow 自补 + native MCP + demo），`bindTools` 绑给模型、`ToolNode` 执行。
- **compaction** — [src/app/compaction.ts](../src/app/compaction.ts)，消费 `config.compaction`。
- **sessionStore** — `FileCheckpointSaver`（继承 `MemorySaver`），持久化到 `config.memory.dir`。

## 扩展（不改源码）

- **加 MCP**：编辑 `config/mcp.default.json`，或经平台面板下发 `ACP_SESSION_CONFIG_JSON.mcpServers`。常用 server 见 [config/mcp.examples.json](../config/mcp.examples.json)（context7 / chrome-devtools / filesystem / bash / duckduckgo）。
- **加 Skill**：放 `skills/builtin/<name>/SKILL.md`（YAML frontmatter `name`/`description` + 正文）。自动发现。
- **加 Subagent**：放 `.agents/agents/<name>/AGENT.md`（frontmatter + 正文=systemPrompt）。在图里用 subgraph 调用（见 [examples/dev-agent/researcher.ts](../examples/dev-agent/researcher.ts)）。
- **改系统提示词**：编辑 `prompts/flow.base.md`，或经 ACP session / `config.agent.systemPrompt`。
- **换模型**：改 `config.model` 或设 `ANTHROPIC_MODEL` / `OPENAI_MODEL`。

## 给目标 Agent 的工具优先级

需要外部能力时按序判断：① MCP 工具（`mcp_tool_bridge list_tools` 发现）→ ② 内置工具（bash/读写/search/http）→ ③ 平台工具（platform_api/agent_variable）→ ④ 自写代码（最后）。
