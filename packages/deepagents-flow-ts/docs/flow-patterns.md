# Flow 编排模式参考(少用 / 进阶)

默认图(`src/app/`)演示的是**常用模式**:纯逻辑节点、LLM 节点、工具调用节点、条件边+循环、state 累积、流式输出、无凭证降级(见各 `nodes/*.ts` 顶部注释)。

这一页收**少用但框架支持**的模式——平时不一定用,但需要时知道有、能照着抄。API 对齐已安装的 `@langchain/langgraph@1.x`(均已导出:`Send`、`interrupt`、`Command`、`MemorySaver`)。

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

需要配合 checkpointer(见第 5 节)持久化暂停点,host(Zed/JetBrains)端实现"采集人类回复 → `invoke(null, { command: { resume } })`"恢复。

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

> 生产持久化换成可序列化的 store(Redis / Postgres / S3),`MemorySaver` 仅进程内。

---

**何时该读这里**:默认图是顺序 ReAct 式(够覆盖大多数编排)。一旦你要 **并行处理多路、需要人审、动态多分支路由、复用整张子图、或要断点续跑** ——回来看对应小节。每段都是最小可抄片段;贴进 `graph.ts` 的连线和节点即可。
