# Flow 编排速查（默认 ReAct）

本仓库**仅保留默认 ReAct 图**（`prepare → think ↔ tools → respond`，见 `src/app/graph.ts`）。节点选型见 [node-catalog.md](node-catalog.md)，factory API 见 [node-kit.md](node-kit.md)。

## 框架优先（强制）

工具执行 / 持久化 / 压缩 / 子智能体（subagent）都优先用 LangGraph、LangChain、deepagents 现成能力：

- 工具 → `tool()`+Zod 的 `StructuredTool` + `bindTools` + `ToolNode` + `toolsCondition`
- 持久化 → `BaseCheckpointSaver`（本模板的 `FileCheckpointSaver` 继承 `MemorySaver`）
- 压缩 → core `trimMessages` + LLM 摘要（见 `src/libs/compaction.ts`）
- 子智能体（subagent）→ 默认图 `task` 工具委派（`src/app/task.tool.ts`，复用默认 ReAct）

不要手搓工具调度、checkpointer、summarizer。

## 标准 ReAct（默认图）

- 拓扑：`prepare → think ↔ tools → respond`。think 用 `bindTools` 出 `tool_calls`，tools 节点执行产出 `ToolMessage`，`toolsCondition` 路由。
- **conversational 多轮对话**：`default` 用 `createStatefulFlow({ conversational: true })`——不暴露 `hasStarted`，surface 每轮走 `query` + 稳定 threadId + checkpointer 累积历史。

## 能力从哪来

节点拿 `FlowRuntime`（`allTools` / `checkpointer` / `systemPrompt` / `ctx.mcpServerConfigs` + `ctx.mcpTools`）—— surface（ACP/CLI）注入，节点不裸调 `resolveModel`。

## 参考

- `src/app/graph.ts` — 默认 ReAct（唯一产品入口）
- [examples.md](examples.md) — 默认路径与交付底座
- `src/libs/nodes/` — factory 目录
