---
name: flow-orchestration-guide
description: 指导如何编排 deepagents-flow-ts 工作流图（节点 / 边 / 条件 / HITL / 并行 / 子图），框架优先
---

# Flow 编排指南

何时用：当你需要设计或修改一个工作流图（LangGraph StateGraph）时。

## 框架优先（强制）

工具执行 / 持久化 / 压缩 / 子代理都优先用 LangGraph、LangChain、deepagents 现成能力：

- 工具 → `tool()`+Zod 的 `StructuredTool` + `bindTools` + `ToolNode` + `toolsCondition`
- 持久化 → `BaseCheckpointSaver`（本模板的 `FileCheckpointSaver` 继承 `MemorySaver`）
- 压缩 → core `trimMessages` + LLM 摘要（见 `src/app/compaction.ts`）
- 子代理 → LangGraph **subgraph**（`addNode(name, compiledSubgraph)`）或 `Send` 并行

不要手搓工具调度、checkpointer、summarizer。

## 核心编排模式

- **标准 ReAct**（默认图）：`prepare → think ↔ tools → respond`。think 用 `bindTools` 出 `tool_calls`，tools 节点执行产出 `ToolMessage`，`toolsCondition` 路由。
- **条件边循环**：`addConditionalEdges(router)` + 上限计数器（防死循环）。
- **HITL（人审）**：`interrupt(...)` 暂停 + `Command({ resume })` 恢复，需 checkpointer + `StatefulFlow`。
- **并行 map-reduce**：`Send` 扇出多路 + reducer 聚合（见 `examples/travel-planner`）。
- **子代理**：把一个编译后的子图作为父图节点（subgraph），子图有独立 state。

## 节点命名坑

LangGraph 限制：**节点名不能与 state channel 同名**。判定字段叫 `decision`、判定节点就叫 `reflect`；plan channel、思考节点 `think`。

## 能力从哪来

节点拿 `FlowRuntime`（`allTools` / `checkpointer` / `systemPrompt` / `ctx.mcpManager`）—— surface（ACP/CLI）注入，节点不裸调 `resolveModel`。

参考：`src/app/graph.ts`（默认图）、`examples/rag`（线性+条件重试）、`examples/travel-planner`（并行+HITL）、`examples/project-manager`（评估循环+HITL）、`examples/dev-agent`（全能力）。
