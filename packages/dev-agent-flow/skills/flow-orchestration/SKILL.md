---
name: flow-orchestration
description: "deepagents-flow-ts 工作流编排核心：StateGraph/Annotation/节点/边/条件路由/Send 并行/interrupt-resume HITL/子图/createStatefulFlow/checkpoint/长任务"
tags: [orchestration, langgraph, stategraph, hitl, send, parallel, subgraph, checkpoint]
version: "3.0.0"
---

# Flow 工作流编排指南

## When to Use
需要设计或修改一个工作流图（LangGraph StateGraph）时——状态定义、节点/边、条件路由、并行 Send、interrupt/resume HITL、checkpointing、子图、长任务流水线。这是 flow-ts 开发的核心技能。

## 框架优先（强制）

工具执行 / 持久化 / 压缩 / 子代理都优先用 LangGraph、LangChain、deepagents 现成能力：
- 工具 -> `tool()` + Zod 的 `StructuredTool` + `bindTools` + `ToolNode` + `toolsCondition`
- 持久化 -> `BaseCheckpointSaver`（本模板的 `FileCheckpointSaver`）
- 压缩 -> core `trimMessages` + LLM 摘要（见 `src/app/compaction.ts`）
- 子代理 -> LangGraph subgraph（`addNode(name, compiledSubgraph)`）或 `Send` 并行

不要手搓工具调度、checkpointer、summarizer。

## 状态定义（Annotation.Root）

```typescript
import { Annotation } from "@langchain/langgraph";

const MyState = Annotation.Root({
  query: Annotation<string>,           // 默认：覆盖语义
  messages: Annotation<BaseMessage[]>({ // 追加语义（消息流）
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  findings: Annotation<Finding[]>({     // 并行写必须配 reducer
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  retryCount: Annotation<number>({      // 累加语义
    reducer: (a, b) => a + b,
    default: () => 0,
  }),
});
type MyStateType = typeof MyState.State;
```

| 语义 | 用途 | reducer |
|------|------|---------|
| 覆盖（默认） | 单值字段（query/output） | 无（后者覆盖前者） |
| 追加 | 消息流、并行聚合 | `(a,b) => [...a, ...b]` |
| 累加 | 计数器 | `(a,b) => a + b` |

> 对话型 Agent 也可直接用 `MessagesAnnotation`（messages 自动追加语义）。
> flow-ts 默认图用自定义 `FlowStateAnnotation`（含 messages + input + output + steps）。

## 核心编排模式

### 1. 标准 ReAct（默认图）
`src/app/graph.ts` 只做连线；节点实现拆在 `src/app/nodes/`（工厂模式）。默认图是标准 ReAct：
```
START -> prepare -> think(model.bindTools) --(toolsCondition)--+
                     ^                                       +-- 有 tool_calls -> tools(ToolNode) -> think
                     +---------------------------------------+
                                              +-- 无 tool_calls -> respond(流式) -> END
```
```typescript
.addConditionalEdges("think", toolsCondition, { tools: "tools", [END]: "respond" })
```

### 2. 条件边循环（线性 + 重试）
```typescript
function routeAfterGrade(state): "rewrite" | "generate" {
  return state.relevant ? "generate" : "rewrite";  // 纯函数，可单测
}
.addConditionalEdges("grade", routeAfterGrade, ["rewrite", "generate"])
```
加上限计数器（防死循环）：state 加 `retryCount`，超过阈值强制走 generate。参考 `examples/rag`。

### 3. 并行 map-reduce（Send 扇出）
```typescript
import { Send } from "@langchain/langgraph";

function fanoutToResearch(state): Send[] {
  return ASPECTS.map(aspect => new Send("research", { aspect, ...state }));
}
.addConditionalEdges("gather", fanoutToResearch, ["research"])
```
每个 Send 派一个并行实例，结果经 reducer 聚合。参考 `examples/travel-planner`（并行 4 路搜索 -> aggregate）。

### 4. reflection 回边（分解->评估->审批）
评估节点产出评分，条件边据评分决定回退重做还是前进：
```typescript
.addConditionalEdges("evaluate", routeAfterEvaluate, ["revise", "approve"])
```
加 `recursionLimit` 护栏防 reflection 死循环。参考 `examples/project-manager`。

### 5. 子图（subgraph）
把编译后的子图作为父图节点（子图有独立 state）：
```typescript
const subgraph = createResearcherGraph(appConfig, checkpointer);
.addNode("researcher", subgraph)
```
参考 `examples/dev-agent`（researcher subgraph）。

### 6. 多阶段流水线（长任务）
多阶段 + 双层 reflection + 持续会话：
`confirm-topic -> confirm-outline -> [Send 并行调研] -> draft -> review -> report -> 持续会话`
用 `onStage` 回调推进度，`recursionLimit` 护栏，FileCheckpointSaver 跨重启续跑。参考 `examples/deep-research`。

## HITL 人审（interrupt / resume + createStatefulFlow）

需要 human-in-the-loop（审批 / 确认 / 多轮交互）或长任务跨重启续跑时用此模式。

### 在节点里 interrupt
```typescript
import { interrupt } from "@langchain/langgraph";

function reviewNode(state): Partial<MyState> {
  const feedback = interrupt({
    question: `草稿：${state.draft}\n请审阅，回复意见或「ok」`,
  });
  return { feedback: String(feedback ?? "") };  // resume 时本节点重跑，interrupt 返回用户回复
}
```

### createStatefulFlow 基座（禁止手写 run-loop）
`src/surfaces/stateful-flow.ts` 的 `createStatefulFlow` 是所有有状态 flow 的统一基座，
统一处理：interrupt/resume 的 stream 驱动、FileCheckpointSaver 持久化（跨进程/IDE 重启续跑）、
hasStarted 续跑推断（从 checkpointer 推断）、recursionLimit 递归护栏、回调穿透（Send 并行实例也拿到）。

只需给三件图相关的事：
```typescript
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import { durableCheckpointer } from "../shared.js";

export function createMyFlow(appConfig?: AppConfig): StatefulFlow {
  return createStatefulFlow<MyStateType>({
    buildGraph: (cp) => createMyGraph(appConfig, cp),  // 用传入 checkpointer 编译图
    toInput: (query) => ({ query }),                   // 新任务：query -> 初始 state
    toResult: (v) => ({ answer: v.output ?? "" }),     // 终态 -> 回答
    checkpointer: durableCheckpointer(appConfig),      // 缺省 MemorySaver；生产用 FileCheckpointSaver
    configurable: { appConfig },                       // 可选：注入给所有节点
    recursionLimit: 50,                                // 可选：防死循环
  });
}
```

### 一个会话一个主题（续跑语义）
```
首条消息 -> 无 checkpoint -> 新任务（toInput 开题）
后续每条 -> 有 checkpoint -> resume 续跑同一项目
```
无论停在 interrupt、出错在某节点、还是已跑完——都续跑同一项目，不重头开新主题。
`hasStarted(threadId)` 从 `graph.getState()` 读 `checkpoint_id`，跨进程/IDE 重启仍准。

### run 返回值
```typescript
type FlowRunResult =
  | { status: "done"; answer: string; footer?: string }      // 跑到底
  | { status: "interrupted"; question: string };              // interrupt 暂停，等用户 resume
```

## Checkpointing
```typescript
const graph = builder.compile({ checkpointer });
graph.invoke(input, { configurable: { thread_id: "session-123" } });
```
| checkpointer | 用途 |
|---|---|
| `MemorySaver` | 内存，开发/单测 |
| `FileCheckpointSaver`（`durableCheckpointer`） | 落盘到 .flow-sessions/，跨重启续跑（flow-ts 默认） |

## 节点函数规范
```typescript
async function myNode(state: MyState): Promise<Partial<MyState>> {
  return { field: "new value" };  // 只返回要更新的字段（不 mutate）
}
```
节点也可读 `config`（第二个参数）拿回调：
```typescript
async function myNode(state, config?: LangGraphRunnableConfig) {
  const onToolCall = config?.configurable?.onToolCall;  // 回调经 configurable 注入
}
```

## 条件边规范
```typescript
function router(state): string {       // 纯路由函数：只读 state，只返回节点名/END
  return state.isDone ? "nextNode" : END;
}
.addConditionalEdges("sourceNode", router, ["nextNode", END])
```
- **禁止**在条件边里做 I/O（纯函数）
- 返回值必须在声明的目标列表中

## 节点命名坑（重要）
LangGraph 限制：**节点名不能与 state channel 同名**。
- `decision` channel -> 判定节点叫 `reflect`，不能叫 `decision`
- `plan` channel -> 思考节点叫 `think`，不能叫 `plan`
- `draft` channel -> 写草稿节点叫 `compose`，不能叫 `draft`

## 调用方式
```typescript
const result = await graph.invoke(input, { configurable: { thread_id } });     // 单次
for await (const event of graph.stream(input, config)) { ... }                 // 流式（逐事件）
for await (const chunk of graph.streamEvents(input, { version: "v2" })) {      // 流式 LLM token
  if (chunk.event === "on_chat_model_stream") process.stdout.write(chunk.data.chunk.content);
}
```

## 能力从哪来
节点拿 `FlowRuntime`（`allTools` / `checkpointer` / `systemPrompt` / `ctx`）——
由 surface（ACP/CLI）注入，节点不裸调 `resolveModel`。详见 `flow-framework` 技能。

## 常见问题
| 问题 | 原因 | 解决 |
|------|------|------|
| 节点名与 channel 冲突报错 | 节点名 = state 字段名 | 改节点名（draft channel -> compose 节点） |
| 并行 Send 数据丢失 | 写 state 没配 reducer | 加 `reducer: (a,b) => [...a, ...b]` |
| MemorySaver.put 报错 | 调用没传 thread_id | configurable 加 thread_id |
| 条件边卡住 | 路由返回值不在目标列表 | 检查 addConditionalEdges 第三参数 |
| 节点无限循环 | 无 END 退出路径 / reflection 死循环 | 加 recursionLimit + 退出条件 |
| interrupt 不工作 | 没 checkpointer / 不是 StatefulFlow | 传 checkpointer + 用 createStatefulFlow |

## Anti-patterns
- 在条件边函数里做 I/O（必须纯路由逻辑）
- 节点名与 state channel 同名（LangGraph 会报错）
- 并行 Send 写 state 不加 reducer（数据会被覆盖）
- 在节点函数里 mutate state（必须返回新对象）
- 手写 run-loop（stream -> 扫 interrupt -> resume 那套，必须用 createStatefulFlow）
- 有状态 flow 不传 checkpointer（重启丢状态）
- 手搓工具调度 / checkpointer / summarizer（用框架原生能力）
- ✅ 条件边抽纯函数 + 单测
- ✅ 并行写配 reducer
- ✅ HITL 用 createStatefulFlow（buildGraph/toInput/toResult 三件套）
- ✅ 生产传 durableCheckpointer（跨重启续跑）
- ✅ reflection 回边加 recursionLimit 护栏
