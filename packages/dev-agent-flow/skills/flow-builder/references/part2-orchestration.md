# Part 2：手写编排（bespoke 图）

> 所属：`flow-builder` L2-B。入口路由见 [SKILL.md](../SKILL.md)。验证见 [part4-verify-debug.md](part4-verify-debug.md)。

需要设计或创建工作流图时：状态定义、节点、边、条件路由、并行 Send、interrupt/resume HITL、子图、长任务流水线。

**跑不通 / 节点未执行 / resume 失败** → 直接读 [part4-verify-debug.md](part4-verify-debug.md)。

## Step 1: 选型与对照

> **节点选型**：`docs/node-catalog.md` + `docs/node-kit.md`。

| 类型 | 场景 | seam | 范例 |
|------|------|------|------|
| `FlowExecutor` | 问答 / 检索 / 批处理 | `(query, cb) => Promise<FlowResult>` | `examples/rag` |
| `StatefulFlow` | HITL / 跨重启 | `createStatefulFlow(...)` | travel / pm / review |

开发位置：`src/app/graph.ts` + `src/app/nodes/` + `src/app/flow-tools.ts`；factory 来自 `src/libs/nodes/`。**examples/ 只读**。

## Step 2: State

```typescript
import { Annotation } from "@langchain/langgraph";

const MyState = Annotation.Root({
  query: Annotation<string>,
  findings: Annotation<Finding[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});
type MyStateType = typeof MyState.State;
```

| 语义 | reducer |
|------|---------|
| 覆盖（默认） | 无 |
| 追加 | `(a,b) => [...a, ...b]` |
| 累加 | `(a,b) => a + b` |

## Step 3: 节点（factory 优先）

`createLlmNode` / `createLlmRouterNode` / `createMcpRetrievalNode` / `createHumanApprovalNode` / `createApprovalFinalizeNode` / `createToolExecNode` / `createFanout` / `createSubgraphNode` 等；bespoke 才在 `src/app/nodes/` 手写并说明原因。

```typescript
async function composeNode(state: MyStateType): Promise<Partial<MyStateType>> {
  return { draft: "..." };  // 不 mutate state
}

function reviewNode(state: MyStateType): Partial<MyStateType> {
  const feedback = interrupt({ question: `草稿：${state.draft}\n回复意见或「ok」` });
  return { feedback: String(feedback ?? "") };
}
```

## Step 4: 连线（graph.ts）

节点名 ≠ state channel 名。

### 条件边
```typescript
function routeAfterGrade(state): "rewrite" | "generate" {
  return state.relevant ? "generate" : "rewrite";
}
.addConditionalEdges("grade", routeAfterGrade, ["rewrite", "generate"])
```
> ⚠️ **condition 返回值必须 ∈ targets**，否则运行时 LangGraph 抛 `Invalid edge`（静态反射 / `pnpm graph` 检不出，需人工核对）。
> `createLlmRouterNode`（Command goto 路由）的目标须经 `addNode(name, fn, { ends: [...] })` 声明，否则反射会丢这些边；custom DSL 在 spec 的 `params.ends` 填。

### Send 扇出
```typescript
import { Send } from "@langchain/langgraph";
function fanoutToResearch(state): Send[] {
  return ASPECTS.map(aspect => new Send("research", { aspect, ...state }));
}
```

### 子图
```typescript
.addNode("researcher", createResearcherGraph(appConfig, checkpointer))
```

## Step 5: 执行器

**one-shot** → `FlowExecutor`。**HITL** → `createStatefulFlow`（禁止手写 run-loop；dev-agent stateful-custom 例外）。

续跑语义：首条开题 → 后续 resume 同一项目（`hasStarted` 从 checkpointer 推断）。

## Step 6: Surface

`bootstrapFlowAcp` / `runFlowCli` 自动分流 one-shot vs stateful。

## 编排模式速查

| 模式 | 关键 API | 范例 |
|------|----------|------|
| ReAct | `toolsCondition` + `bindTools` | 默认图 |
| 条件重试 | `addConditionalEdges` | `examples/rag` |
| Send 并行 | `Send` + reducer | `examples/travel-planner` |
| reflection | `createLlmRouterNode` 或条件边 | pm / deep-research |
| HITL | `interrupt` + resume | `examples/human-in-loop` |
| 长任务 | `onStage` + checkpoint | `examples/deep-research` |

## Anti-patterns

- ❌ 手写 run-loop（用 createStatefulFlow）
- ❌ 节点名与 channel 同名
- ❌ Send 不加 reducer
- ❌ 条件边里做 I/O
- ❌ mutate state
- ❌ index.ts 直接 `graph.invoke`
- ✅ 条件边纯函数 + 单测；`durableCheckpointer` 跨重启
