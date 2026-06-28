# Flow 编排指南

设计或修改本仓库内一张工作流图（LangGraph StateGraph）时的**编排速查**。节点选型见 [node-catalog.md](node-catalog.md)、factory API 见 [node-kit.md](node-kit.md)、进阶原生模式见 [flow-patterns.md](flow-patterns.md)——本页只收「框架优先 + 核心编排模式 + 易踩的坑」。

## 框架优先（强制）

工具执行 / 持久化 / 压缩 / 子智能体（subagent）都优先用 LangGraph、LangChain、deepagents 现成能力：

- 工具 → `tool()`+Zod 的 `StructuredTool` + `bindTools` + `ToolNode` + `toolsCondition`
- 持久化 → `BaseCheckpointSaver`（本模板的 `FileCheckpointSaver` 继承 `MemorySaver`）
- 压缩 → core `trimMessages` + LLM 摘要（见 `src/libs/compaction.ts`）
- 子智能体（subagent）→ LangGraph **subgraph**（`addNode(name, compiledSubgraph)`）或 `Send` 并行

不要手搓工具调度、checkpointer、summarizer。

## 核心编排模式

- **标准 ReAct**（默认图）：`prepare → think ↔ tools → respond`。think 用 `bindTools` 出 `tool_calls`，tools 节点执行产出 `ToolMessage`，`toolsCondition` 路由。
- **条件边循环**：`addConditionalEdges(router)` + 上限计数器（防死循环）。
- **HITL（人审）**：`interrupt(...)` 暂停 + `Command({ resume })` 恢复，需 checkpointer + `StatefulFlow`。
- **并行 map-reduce**：`Send` 扇出多路 + reducer 聚合（见 `examples/travel-planner`）。
- **子智能体（subagent）**：把一个编译后的子图作为父图节点（subgraph），子图有独立 state。
- **自适应 RAG**（`libs/topologies/adaptive-rag`，对齐官方 Adaptive RAG）：`route_question` 路由（向量检索 / 网页搜索 / 直接回答）+ `grade_documents` 文档评分 + `grade_generation` 幻觉/答案双评分 + 检索/生成双自纠正循环（带上限计数器）。适合需要路由与生成质量把关的进阶问答。
- **conversational 多轮对话**：对话型 flow（`default` / `knowledge-qa` / `adaptive-knowledge-qa` / `customer-support`）用 `createStatefulFlow({ conversational: true })`——不暴露 `hasStarted`，surface 每轮走 `query` + 稳定 threadId + checkpointer 累积历史 → 多轮记忆（区别于 HITL 的 `resume` 续跑同一任务）。

## 节点命名坑

LangGraph 限制：**节点名不能与 state channel 同名**。判定字段叫 `decision`、判定节点就叫 `reflect`；plan channel、思考节点 `think`。

## 能力从哪来

节点拿 `FlowRuntime`（`allTools` / `checkpointer` / `systemPrompt` / `ctx.mcpServerConfigs` + `ctx.mcpTools`）—— surface（ACP/CLI）注入，节点不裸调 `resolveModel`。

## 参考

`src/app/graph.ts`（默认图）、`examples/rag`（线性+条件重试）、`examples/travel-planner`（并行+HITL）、`examples/project-manager`（评估循环+HITL）、`examples/dev-agent`（全能力）、`libs/topologies/adaptive-rag`（路由 + 检索/生成双自纠正，conversational）。
