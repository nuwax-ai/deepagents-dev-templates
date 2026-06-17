---
name: flow-builder
description: "flow-ts 工作流设计与编排：State 定义 -> 节点(工厂模式) -> graph.ts 连线 -> 执行器包装(FlowExecutor/createStatefulFlow) -> surface 挂接。编排模式：ReAct/条件路由/Send 并行/HITL interrupt-resume/子图/长任务。LangGraph API 细节用 Context7 查"
tags: [flow, orchestration, stategraph, hitl, send, creation, graph, nodes, flow-ts]
version: "1.0.0"
---

# Flow 设计与编排（flow-ts）

## When to Use
需要设计或创建一个工作流图时：状态定义、节点、边、条件路由、并行 Send、interrupt/resume HITL、子图、长任务流水线。

> LangGraph/LangChain API 细节（`Annotation.Root`、`Send`、`interrupt`、`Command`、`StateGraph` 等）用 Context7 查最新文档：`resolve-library-id("langgraph")` → `query-docs`。本技能聚焦 flow-ts 的结构约定与编排模式。

## Step 1: 选型与对照

| 类型 | 场景 | seam | 范例 |
|------|------|------|------|
| `FlowExecutor` | 问答 / 检索 / 批处理 | 函数 `(query, cb) => Promise<FlowResult>` | `examples/rag` |
| `StatefulFlow` | 审批 / 确认 / HITL / 跨重启 | `createStatefulFlow(...)` | travel / pm / review / deep-research |

> **examples/ 纯只读**。读范例学拓扑，在 **`src/app/`** 实现（改 graph.ts 连线、nodes/ 节点、tools/ 工具）。

开发位置：`src/app/` 的 `graph.ts`（连线）+ `nodes/`（节点）+ `tools/`（工具）

## Step 2: 写 State 定义

```typescript
import { Annotation } from "@langchain/langgraph";

const MyState = Annotation.Root({
  query: Annotation<string>,
  draft: Annotation<string>,
  feedback: Annotation<string>,
  output: Annotation<string>,
  // 并行写必须加 reducer
  findings: Annotation<Finding[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});
type MyStateType = typeof MyState.State;
```

| 语义 | 用途 | reducer |
|------|------|---------|
| 覆盖（默认） | 单值字段（query/output） | 无 |
| 追加 | 消息流、并行聚合 | `(a,b) => [...a, ...b]` |
| 累加 | 计数器 | `(a,b) => a + b` |

## Step 3: 写节点函数

> **节点工厂模式**：需运行时依赖的节点走工厂（`createXxxNode(deps)` 返回闭包）；纯节点直接导出函数。照 `src/app/nodes/` 模式。

```typescript
async function composeNode(state: MyStateType): Promise<Partial<MyStateType>> {
  // 从 config 拿 model（不裸调 resolveModel）
  return { draft: "..." };  // 只返回要更新的字段，不 mutate state
}

function reviewNode(state: MyStateType): Partial<MyStateType> {
  const feedback = interrupt({ question: `草稿：${state.draft}\n回复意见或「ok」` });
  return { feedback: String(feedback ?? "") };
}
```

> `examples/shared.ts` 提供共用工具函数：`requireModel`/`extractText`/`isApproval`/`durableCheckpointer`/`emitStage`/`emitPlan`/`emitTextToken`/`runTool`/`invokeWithResilience`/`resolveLlmResilience`

## Step 4: 写连线（graph.ts）

```typescript
export function createMyGraph(appConfig?: AppConfig, checkpointer = new MemorySaver()) {
  return new StateGraph(MyState)
    .addNode("compose", (s) => composeNode(s, appConfig))
    .addNode("review", reviewNode)
    .addNode("finalize", (s) => finalizeNode(s, appConfig))
    .addEdge(START, "compose")
    .addEdge("compose", "review")
    .addEdge("review", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer });
}
```

> **节点名不能与 state channel 同名**（LangGraph 限制）：`draft` channel -> 节点叫 `compose`，不叫 `draft`。

### 条件边（纯函数路由）
```typescript
function routeAfterGrade(state): "rewrite" | "generate" {
  return state.relevant ? "generate" : "rewrite";  // 纯函数，可单测
}
.addConditionalEdges("grade", routeAfterGrade, ["rewrite", "generate"])
```

### 并行 map-reduce（Send 扇出）
```typescript
import { Send } from "@langchain/langgraph";
function fanoutToResearch(state): Send[] {
  return ASPECTS.map(aspect => new Send("research", { aspect, ...state }));
}
.addConditionalEdges("gather", fanoutToResearch, ["research"])
```

### 子图（subgraph）
```typescript
const subgraph = createResearcherGraph(appConfig, checkpointer);
.addNode("researcher", subgraph)
```

## Step 5: 包成执行器

### one-shot FlowExecutor
```typescript
import type { FlowExecutor } from "../../src/core/flow-types.js";
const executor: FlowExecutor = async (query, { onToken, onToolCall }) => {
  const res = await executeMyGraph(query, { config, callbacks: { onToken, onToolCall } });
  return { answer: res.answer };
};
```

### StatefulFlow（用 createStatefulFlow 基座 — 禁止手写 run-loop）
```typescript
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import { durableCheckpointer } from "../shared.js";

export function createMyFlow(appConfig?: AppConfig): StatefulFlow {
  return createStatefulFlow<MyStateType>({
    buildGraph: (cp) => createMyGraph(appConfig, cp),
    toInput: (query) => ({ query }),
    toResult: (v) => ({ answer: v.output ?? "" }),
    checkpointer: durableCheckpointer(appConfig),
    recursionLimit: 50,
  });
}
```

### 一个会话一个主题（续跑语义）
```
首条消息 -> 无 checkpoint -> 新任务（toInput 开题）
后续每条 -> 有 checkpoint -> resume 续跑同一项目
```
`hasStarted(threadId)` 从 checkpointer 推断，跨进程/IDE 重启仍准。

## Step 6: 挂接 surface（index.ts）

```typescript
import { bootstrapFlowAcp } from "../../src/surfaces/acp/server.js";
import { runFlowCli } from "../../src/surfaces/cli/run.js";

await bootstrapFlowAcp({ executor, appConfig, debug });
// 或 stateful: await bootstrapFlowAcp({ executor: createMyFlow(appConfig), appConfig });
// 或 per-session 工厂: await bootstrapFlowAcp({ createExecutor, appConfig });
```
surface 自动分流：function -> one-shot；对象（有 run）-> stateful HITL。

## 编排模式速查

| 模式 | 拓扑 | 关键 API | 范例 |
|------|------|----------|------|
| 标准 ReAct | prepare→think↔tools→respond | `toolsCondition` + `bindTools` | 默认图 |
| 条件重试 | 线性 + 重试环 | `addConditionalEdges` + 计数器 | `examples/rag` |
| 并行聚合 | Send 扇出 + reducer | `Send` + reducer | `examples/travel-planner` |
| reflection | 分解→评估→审批回边 | 条件边 + `recursionLimit` | `examples/project-manager` |
| HITL | 生成→人审→定稿 | `interrupt` + resume | `examples/human-in-loop` |
| 子图 | ReAct + subgraph | `addNode(name, compiledSubgraph)` | `examples/dev-agent` |
| 长任务 | 多阶段流水线 | 双层 reflection + `onStage` + checkpoint | `examples/deep-research` |

## Anti-patterns
- ❌ 手写 run-loop（必须用 createStatefulFlow）
- ❌ 节点名与 channel 同名（LangGraph 会报错）
- ❌ 并行 Send 写 state 不加 reducer（数据会被覆盖）
- ❌ 在条件边函数里做 I/O（必须纯路由逻辑）
- ❌ 在节点函数里 mutate state（返回新对象）
- ❌ 有状态 flow 不传 checkpointer（重启丢状态）
- ❌ 在 index.ts 直接调 graph.invoke（必须经 bootstrapFlowAcp / runFlowCli）
- ✅ 条件边抽纯函数 + 单测
- ✅ HITL 用 createStatefulFlow（buildGraph/toInput/toResult）
- ✅ reflection 回边加 recursionLimit 护栏
- ✅ 生产传 durableCheckpointer（跨重启续跑）
