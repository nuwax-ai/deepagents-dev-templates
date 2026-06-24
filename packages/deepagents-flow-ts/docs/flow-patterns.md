# Flow 编排模式参考(少用 / 进阶)

默认图(`src/app/`)演示的是**常用模式**:纯逻辑节点、LLM 节点、工具调用节点、条件边+循环、state 累积、流式输出、无凭证降级(见各 `nodes/*.ts` 顶部注释)。

这一页收**少用但框架支持**的模式——平时不一定用,但需要时知道有、能照着抄。API 对齐已安装的 `@langchain/langgraph@1.x`(均已导出:`Send`、`interrupt`、`Command`、`MemorySaver`)。

> **优先用 factory**:下面的 Send / interrupt / subgraph 等模式,框架已收成 `src/libs/nodes/` 的 factory
> (`createFanout` / `createHumanApprovalNode` / `createApprovalFinalizeNode` / `createLlmRouterNode` / `createMcpRetrievalNode` / `createSubgraphNode` 等),选型见 [node-catalog.md](node-catalog.md)、API 见 [node-kit.md](node-kit.md)。
> 能用 factory 就别手写原生模式;只有 bespoke 节点(多源检索取优、文件交付等,见 node-catalog ②)才回这里看原生 API。

> 真实业务里把这些加到 `src/app/graph.ts` 的 `addNode`/`addEdge`/`addConditionalEdges` 即可。

## 1. Send:并行 fan-out(map-reduce)

一个节点同时派发**多个**子任务(每个一份 state),结果汇总回同一 channel。典型场景:对 N 个条目并行处理再聚合。

```ts
import { StateGraph, START, END, Annotation, Send } from "@langchain/langgraph";

// channel 用 reducer 聚合(并行写才安全):
const S = Annotation.Root({
  items: Annotation<string[]>,
  results: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
});

// fan-out:返回 Send[] 给每个条目派一个 "process" 节点实例
const fanout = (state: typeof S.State) =>
  state.items.map((it) => new Send("process", { ...state, item: it }));

const graph = new StateGraph(S)
  .addNode("process", async (s) => ({ results: [`done: ${s.item}`] }))
  .addConditionalEdges(START, fanout)
  .addEdge("process", END)
  .compile();
```

> 顺序流里默认图的 `observe` 节点手动 append 即可;**只有并行写同一 channel 时才必须用 reducer**(否则写入会互相覆盖)。

## 2. interrupt:人工介入(human-in-the-loop)

跑到某节点时**暂停**、把问题抛给用户,拿到回复后继续。

```ts
import { interrupt } from "@langchain/langgraph";

// 在节点里调用即暂停;command 里 resume 的值会作为返回值
const reviewNode = async (state) => {
  const approved = interrupt({ question: "这样可以吗?", draft: state.output });
  return { approved };
};
```

需要配合 checkpointer(见第 5 节)持久化暂停点,host(Zed/JetBrains)端实现"采集人类回复 → `invoke(null, { command: new Command({ resume }) })`"恢复(`Command` 见第 3 节)。

## 3. Command:节点返回式路由 / 更新

节点直接返回 goto + update,不必走 `addConditionalEdges`(适合动态、多分支路由)。

```ts
import { Command } from "@langchain/langgraph";

const router = async (state) => {
  if (state.needsTool) return new Command({ goto: "act", update: { plan: pickNext(state) } });
  return new Command({ goto: "respond" });
};
```

## 4. 子图(subgraph):把一张图当节点用

把已有图 `.compile()` 后作为另一个图的节点,实现编排的分层组合。

```ts
const sub = new StateGraph(SubState).addNode(...).compile();
const parent = new StateGraph(ParentState)
  .addNode("subStep", sub)          // 直接把编译后的图当节点
  .addEdge(START, "subStep")
  .addEdge("subStep", END)
  .compile();
```

## 5. Checkpointer:持久化 / 断点续跑 / 时间旅行

给图加 checkpointer,state 每步落盘 → 可断点恢复、回放、人工介入的暂停点。

```ts
import { MemorySaver } from "@langchain/langgraph";

const graph = createFlowGraph().compile({ checkpointer: new MemorySaver() });
// 同一 thread_id 下多次 invoke 会延续 state
await graph.invoke({ input: "..." }, { configurable: { thread_id: "t1" } });
```

> `MemorySaver` 仅进程内 —— 一旦进程/IDE 重启，暂停点就丢了。模板因此自带
> **`FileCheckpointSaver`**（`src/runtime/services/file-checkpoint-saver.ts`）：标准 checkpointer 协议 +
> 文件落盘，跨进程/重启也能 `getState`/resume。生产规模可换 sqlite/postgres saver（接口已对齐）。
>
> ⚠️ 落盘要点：MemorySaver 的 storage 里存的是 serde 产出的 `Uint8Array`；朴素 `JSON.stringify`
> 会把它变成 `{"0":..}` 普通对象、重载即报 `loadsTyped` 错。`FileCheckpointSaver` 用 base64 包装
> 保真（见该文件 `replaceBytes`/`reviveBytes`）。自定义文件型 saver 时务必处理二进制。

## 6. 长任务硬化:多轮 + 跨重启 + 进度 + 护栏

多阶段、多轮 HITL 的**长任务**（如 [deep-research](../examples/deep-research/)）光有 `interrupt` 不够——
还要解决「跑到一半重启了怎么续」「N 步流水线进度看不见」「reflection 回边/LLM 挂死跑飞」。
模板把这些收进 **`createStatefulFlow`**（`src/surfaces/stateful-flow.ts`），有状态示例都基于它：

```ts
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import { durableCheckpointer } from "../shared.js";

export function createMyFlow(appConfig?, opts: { checkpointer?: BaseCheckpointSaver } = {}) {
  return createStatefulFlow<MyState>({
    buildGraph: (cp) => createMyGraph(appConfig, cp),   // 图工厂接收 checkpointer
    toInput: (query) => ({ goal: query }),               // 新任务：query → 初始 state
    toResult: (v) => ({ answer: v.output ?? "" }),       // 终态 → 回答
    checkpointer: durableCheckpointer(appConfig, opts.checkpointer), // 默认 FileCheckpointSaver
    configurable: { appConfig },     // 透传给 Send 并行实例（onToolCall/onStage 基座自动注入）
    recursionLimit: 50,              // 护栏:防 reflection 回边死循环
  });
}
```

它一处实现了所有有状态示例原本各自重抄的 run-loop，并叠加四个长任务硬化点：

| 硬化点 | 怎么做 | 为什么 |
|---|---|---|
| **跨重启续跑** | checkpointer 默认 `FileCheckpointSaver`（落盘） | 重启后暂停点不丢 |
| **一个会话一个主题** | `hasStarted()` 读 `graph.getState()` 是否已有 checkpoint，**非进程内存** | 首条 prompt 开题，之后每条都续跑同一项目（停在 interrupt / 出错 / 已完成皆然）→ 绝不把消息误当「新主题」重头开始；且重启后仍准 |
| **阶段进度** | 节点 `emitStage(config, { stage, detail })` → `onStage` 回调 | 长流水线每步可见（CLI 打印 `▸`，ACP 发 message chunk） |
| **单步护栏** | `recursionLimit` + `withTimeout(model.invoke(...), ms)` | 回边/挂死步骤不拖垮整图 |

> **conversational 模式**（`conversational: true`，区别于上述 HITL 长任务）：
> 默认有状态示例用 `hasStarted` 做「一个会话一个主题」续跑；**对话型 flow**（default /
> knowledge-qa / adaptive-knowledge-qa / customer-support）传 `conversational: true` →
> `createStatefulFlow` **不暴露 `hasStarted`**，surface 每轮都走 `query`（配合稳定
> threadId = ACP sessionId + checkpointer），历史经 `MessagesAnnotation` reducer 自动累积
> → **多轮记忆**；图层 `graph.stream` 真流式。图逻辑不变，只是 surface 入口从「续跑同一任务」
> 变成「多轮对话」。压缩仍在新 query 入口触发。见 `src/app/default-flow.ts` 的 `recipe()`
> 与 `src/surfaces/stateful-flow.ts` 的 `conversational` 选项。

> **长任务上下文压缩**:多轮消息累积超阈值时，`compactHistory` 摘要旧历史，再用
> `compactionUpdate`（`RemoveMessage` 替换模式）写回 channel。见 [dev-agent](../examples/dev-agent/) 的 run-loop
> 与 `src/libs/compaction.ts`（`config.compaction` 控制触发）。

---

**何时该读这里**:默认图是顺序 ReAct 式(够覆盖大多数编排)。一旦你要 **并行处理多路、需要人审、动态多分支路由、复用整张子图、断点续跑、或做跨重启的长任务** ——回来看对应小节。每段都是最小可抄片段;贴进 `graph.ts` 的连线和节点即可。

---

## 可跑示例对照

文档里的模式，下面这些示例已经落成**可跑代码**（不只是片段）：

| 模式 | 可跑示例 |
|---|---|
| `Send` 并行 map-reduce + reducer | [examples/travel-planner](../examples/travel-planner/)（并行 research 4 路 + 聚合） |
| `interrupt` 人审 / HITL | [examples/human-in-loop](../examples/human-in-loop/)、[travel-planner](../examples/travel-planner/)、[project-manager](../examples/project-manager/) |
| 条件边循环（评估重试） | [examples/project-manager](../examples/project-manager/)、默认图 `reflect` |
| 多阶段流水线 + 多轮 HITL + 双层 reflection + 并行调研 + **持续会话** | [examples/deep-research](../examples/deep-research/)（长任务示例：选题确认 → 大纲规划 → Send 并行调研 → 初稿 → 质量评审 → 报告 → **converse↔respond 持续会话回路**，2 确认门 + 2 reflection 循环 + 报告后就同一研究反复改/问，回「结束」定稿） |
| 长任务硬化（跨重启续跑 + 阶段进度 + 单步护栏） | `createStatefulFlow`（`src/surfaces/stateful-flow.ts`）——deep-research / travel / pm / human-in-loop 全部基于它；持久化默认 `FileCheckpointSaver` |
| 长任务上下文压缩（摘要 + `RemoveMessage` 替换） | [examples/dev-agent](../examples/dev-agent/) run-loop + `src/libs/compaction.ts` |
| 条件边路由 + 检索/生成**双自纠正循环**（对齐官方 Adaptive RAG） | [libs/topologies/adaptive-rag](../src/libs/topologies/adaptive-rag/)（app flow `adaptive-knowledge-qa`） |
| **conversational 多轮对话**（不暴露 `hasStarted` + 稳定 threadId + checkpointer 累积历史 + 图层流式） | `createStatefulFlow`（`conversational: true`）：default / knowledge-qa / adaptive-knowledge-qa / customer-support |

> `interrupt` 的"采集回复 → resume"已由模板的 **`StatefulFlow`** seam 在 acp/cli surface 接好——
> 不用自己写 host 端恢复逻辑。且续跑状态由 checkpointer 推断（`hasStarted`）——**一个会话一个主题**：
> 首条开题、之后都续跑同一项目，**进程/IDE 重启后仍能续跑**（见各示例的 `createXxxFlow` 与第 6 节）。
