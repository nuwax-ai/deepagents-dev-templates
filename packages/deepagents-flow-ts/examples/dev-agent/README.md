# dev-agent — 综合能力示例

把 `deepagents-flow-ts` 模板的全部能力串成一个可跑的 Agent，演示「开发模板」如何落地一个真实场景。

## 覆盖的能力

| 能力 | 在哪看 | 框架原生 |
| --- | --- | --- |
| 标准 ReAct 图（think ↔ tools） | `createFlowGraph`（复用默认图） | LangGraph `StateGraph` + `toolsCondition` |
| 真实工具调度 | `runtime.allTools`（bash/读写/search/http/context7 MCP） | `bindTools` + `ToolNode` |
| 会话持久化 / 跨重启续接 | `runtime.checkpointer`（FileCheckpointSaver）+ 同一 threadId | `BaseCheckpointSaver` |
| 上下文压缩 | [`compactHistory`](../../src/app/compaction.ts)（单测覆盖；图内写回用 RemoveMessage 替换模式） | core `trimMessages` + LLM 摘要 |
| Subagent | [`researcher.ts`](./researcher.ts)（subgraph） | LangGraph **subgraph** |
| 能力分层 / 可查询 | `flow capabilities` / `.nuwax-agent/` | — |

## 跑

```bash
# 配凭证（任一）
export ANTHROPIC_API_KEY=...

# 单次
pnpm example:dev-agent "用 context7 查 langgraph ToolNode 的用法，给我一个最小示例"

# 交互（多轮续接，同一 threadId → 历史累积 → 触发压缩）
pnpm example:dev-agent -i

# 看持久化的会话
pnpm flow sessions
```

无凭证时默认图走 fallback（回显输入），仍可验证图闭环与持久化。

## 它怎么串起来

```
createFlowRuntime(appConfig)
  → ctx (createRuntimeContextAsync): mcpManager / platformClient / mcpTools
  → allTools = app-ts 通用 + flow 自补(bash/fs/search/demo/mcp-bridge) + native MCP(context7)
  → checkpointer = FileCheckpointSaver (← MemorySaver)

createDevAgentFlow(runtime)
  → createFlowGraph({ allTools, checkpointer, config, systemPrompt })
  → StatefulFlow.run({query}, threadId):
      1. compactHistory(现有 messages)   ← 压缩接入点
      2. graph.invoke({input, messages}, {configurable:{thread_id}})
           prepare → think(bindTools) ↔ tools(ToolNode) → respond
      3. return { answer }
```

## Subagent（subgraph）

[`researcher.ts`](./researcher.ts) 定义一个独立编译的 researcher 子图。把它作为父图节点：

```ts
const researcher = createResearcherSubgraph(appConfig, allTools);
parentGraph.addNode("research", researcher);                 // 子图作节点
parentGraph.addConditionalEdges("think", (s) =>
  needsResearch(s) ? "research" : "respond"
);
```

子图有独立 state（messages），父子经共享 channel 映射——这就是 flow-ts 里 Subagent 的框架原生实现，不需要自建委托工具。
