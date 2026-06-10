---
name: langgraph-patterns
description: "LangGraph TypeScript 核心模式：StateGraph、MessagesAnnotation、节点/边定义、checkpointing、stream 调用"
tags: [langgraph, stategraph, graph, typescript, checkpointing]
version: "1.0.0"
---

# LangGraph 使用模式

## When to Use

需要理解或编写 LangGraph 图结构时使用——包括定义状态、添加节点和边、条件路由、checkpointing、以及与 deepagents 框架的集成关系。

---

## 核心概念

deepagents 框架基于 LangGraph 构建。`createDeepAgent()` 内部创建并管理一个 `StateGraph`。开发者不需要直接写 StateGraph，但理解 LangGraph 有助于调试图执行流程和理解框架行为。

---

## 基础模式：MessagesAnnotation（推荐）

对话型 Agent 使用 `MessagesAnnotation` 作为标准状态：

```typescript
import {
  StateGraph,
  MessagesAnnotation,
  START,
  END,
} from "@langchain/langgraph";
import type { AIMessage } from "@langchain/core/messages";

// 节点函数：接收状态，返回状态更新
async function callModel(state: typeof MessagesAnnotation.State) {
  const response = await model.invoke(state.messages);
  return { messages: [response] }; // messages 是追加语义（reducer 自动合并）
}

function shouldContinue(state: typeof MessagesAnnotation.State): "tools" | typeof END {
  const lastMsg = state.messages.at(-1) as AIMessage;
  return lastMsg.tool_calls?.length ? "tools" : END;
}

// 构建图
const agent = new StateGraph(MessagesAnnotation)
  .addNode("llmCall", callModel)
  .addNode("toolNode", toolNode)
  .addEdge(START, "llmCall")
  .addConditionalEdges("llmCall", shouldContinue, ["toolNode", END])
  .addEdge("toolNode", "llmCall")
  .compile({ checkpointer: new MemorySaver() });
```

---

## 自定义状态：StateSchema

需要携带额外字段时：

```typescript
import { StateGraph, StateSchema, MessagesValue, ReducedValue } from "@langchain/langgraph";
import { z } from "zod";

const MyState = new StateSchema({
  messages: MessagesValue,
  stepCount: new ReducedValue(
    z.number().default(0),
    { reducer: (current, update) => current + update }
  ),
});

const graph = new StateGraph(MyState)
  .addNode("myNode", async (state) => {
    return { stepCount: 1 }; // reducer 自动加到现有值
  })
  .compile();
```

也可使用旧式 `Annotation.Root()`（仍受支持）：

```typescript
import { Annotation } from "@langchain/langgraph";

const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  context: Annotation<string>({ default: () => "" }),
});
```

---

## 节点（Node）

节点是普通异步函数：

```typescript
// 节点函数签名
async function myNode(
  state: typeof MessagesAnnotation.State
): Promise<Partial<typeof MessagesAnnotation.State>> {
  // 返回状态的部分更新
  return { messages: [new AIMessage("...done")] };
}
```

---

## 边（Edge）

```typescript
// 固定边：总是从 a 流向 b
.addEdge("nodeA", "nodeB")

// 条件边：根据状态动态决定下一个节点
.addConditionalEdges(
  "nodeA",                    // 源节点
  routerFn,                   // (state) => node_name | END
  ["nodeB", "nodeC", END]     // 可能的目标列表（可选，用于静态分析）
)
```

---

## Checkpointing

```typescript
import { MemorySaver } from "@langchain/langgraph-checkpoint";

// 内存持久化（开发用）
const checkpointer = new MemorySaver();

const app = graph.compile({ checkpointer });

// 调用时需要 thread_id
const result = await app.invoke(
  { messages: [new HumanMessage("Hello")] },
  { configurable: { thread_id: "session-123" } }
);

// 同一 thread_id 的后续调用会接续上次对话状态
```

---

## 调用方式

```typescript
// 单次调用（返回最终状态）
const result = await app.invoke({
  messages: [new HumanMessage("What is 2+2?")],
}, { configurable: { thread_id: "t1" } });

// 流式调用（逐事件）
for await (const event of app.stream(input, config)) {
  // event 是状态更新对象
  console.log(event);
}

// 流式 LLM token
for await (const chunk of app.streamEvents(input, { version: "v2" })) {
  if (chunk.event === "on_chat_model_stream") {
    process.stdout.write(chunk.data.chunk.content);
  }
}
```

---

## 与 deepagents 的集成关系

`deepagents` 在 `createDeepAgent()` 中已封装好一个标准 LangGraph agent 图，包括：
- 工具调用循环（LLM → 工具 → LLM）
- `MemorySaver` checkpointer（ACP 模式）
- 中间件链（stuck-loop 检测、周期性提醒、成本跟踪等）

**开发者不需要直接写 StateGraph**，只需要：
1. 在 `src/app/tools/` 创建工具
2. 通过 `createTools()` 注册
3. `createDeepAgent()` 会自动把工具绑定到内部图

---

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `MemorySaver.put` 报错 | 调用时没有传 `thread_id` | 在 `configurable` 中加 `thread_id` |
| 状态更新不生效 | 返回的字段名与 StateSchema 不匹配 | 检查字段名拼写 |
| 条件边卡住 | 路由函数返回值不在声明的目标列表中 | 检查 `addConditionalEdges` 的第三个参数 |
| 节点无限循环 | 没有到 END 的退出路径 | 确认条件边有返回 `END` 的路径 |

## Anti-patterns

- ❌ 在 deepagents 模板中直接绕过 `createDeepAgent()` 自己建 StateGraph
- ❌ 在节点函数中直接 mutate state（必须返回新对象）
- ❌ 不传 `thread_id` 就使用 checkpointer（会报错）
- ❌ 把外部 I/O 副作用放在条件边函数里（边函数应该是纯路由逻辑）
- ✅ 利用 `MessagesAnnotation` 作为对话状态的标准起点
- ✅ 条件边函数保持纯函数（只读状态，只返回节点名）
- ✅ 每个节点只负责一件事