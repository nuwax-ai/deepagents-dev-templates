---
name: capability-discovery
description: 发现 flow-ts 的可用工具 / MCP / Skills / Subagent，以及如何配置与扩展能力分层
---

# 能力发现

何时用：当你不确定 Agent 有哪些工具可用、或想新增一个能力时。

## 查询当前能力

```bash
deepagents-flow-ts capabilities   # 无凭证，输出工具/MCP/skills/能力分层
deepagents-flow-ts sessions       # 已持久化的会话
```

## 能力分层

| 层 | 来源 | 例子 | 可编辑 |
| --- | --- | --- | --- |
| **基础能力**（agent-builtin） | 模板内置 | bash / 文件读写 / search / http / json / mcp_tool_bridge / platform_api / agent_variable / demo | 否（改源码） |
| **扩展能力**（acp-dynamic） | ACP / nuwax 面板 / config | MCP servers / Skills / Subagent / 系统提示词 / 模型 | 是 |
| 环境（env-builtin） | 环境变量 | API key / base URL | env |
| 文件持久化（agent-builtin-file） | 模板会话目录 | sessionStore（`.flow-sessions/`） | 否 |

完整映射见 `.nuwax-agent/capability-sources.json`。

## 扩展能力（不改源码）

- **加 MCP**：编辑 `config/mcp.default.json`（或经平台面板下发 `ACP_SESSION_CONFIG_JSON.mcpServers`）。`mergeStrategy: session-wins` → 会话级覆盖平台级覆盖默认。常用：context7（文档）、chrome-devtools（浏览）、duckduckgo（搜索）—— 见 `config/mcp.examples.json`。
- **加 Skill**：放 `skills/builtin/<name>/SKILL.md`（YAML frontmatter + 正文）。`resolveSkillsPaths` 自动发现。
- **加 Subagent**：放 `.agents/agents/<name>/AGENT.md`（声明式）。`discoverSubAgents` 自动发现；在图里用 subgraph 调用。
- **改系统提示词**：编辑 `prompts/flow.base.md`，或经 ACP session / `config.agent.systemPrompt` 下发。
- **换模型**：改 `config/flow-agent.config.json` 的 `model`，或设 `ANTHROPIC_MODEL` / `OPENAI_MODEL`。

## 工具优先级（给目标 Agent）

需要外部能力时：① MCP 工具（先 `mcp_tool_bridge list_tools` 发现）→ ② 内置工具（bash/读写/search/http）→ ③ 平台工具（platform_api）→ ④ 自写代码（最后）。
