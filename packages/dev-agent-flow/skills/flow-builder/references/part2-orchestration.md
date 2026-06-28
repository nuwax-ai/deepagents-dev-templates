# Part 2：手写编排（bespoke 图）

> 所属：`flow-builder` L2-B。入口路由见 [SKILL.md](../SKILL.md)。验证见 [part4a-verify-debug.md](part4a-verify-debug.md)。

需要设计或创建工作流图时：状态定义、节点、边、条件路由、并行 Send、interrupt/resume HITL、子图、长任务流水线。

**跑不通 / 节点未执行 / resume 失败** → 直接读 [part4a-verify-debug.md](part4a-verify-debug.md)。

## Step 1: 选型与对照

> **节点选型**：`docs/node-catalog.md` + `docs/node-kit.md`。

| 类型 | 场景 | seam | 范例 |
|------|------|------|------|
| `FlowExecutor` | 问答 / 检索 / 批处理 | `(query, cb) => Promise<FlowResult>` | `examples/rag` |
| `StatefulFlow` | HITL / 跨重启 | `createStatefulFlow(...)` | `examples/travel-planner` / `project-manager` / `human-in-loop` |

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

`createLlmNode` / `createLlmRouterNode` / `createMcpRetrievalNode` / `createHumanApprovalNode` / `createPermissionApprovalNode` / `createApprovalFinalizeNode` / `createToolExecNode` / `createFanout` / `createSubgraphNode` 等；bespoke 才在 `src/app/nodes/` 手写并说明原因。

### createLlmNode 与 parseJson

**硬规则见目标项目 `docs/flow-graph-rules.md`**（**R-G001 MUST**、**R-G002 SHOULD**、**R-G003 MUST**）。flow-builder 路由页：[flow-graph-rules-pointer.md](flow-graph-rules-pointer.md)。

摘要：

1. **仅当 `write` 读取 `r.parsed` 时才加 `parse: parseJson`**（R-G001）
2. **图入口 LLM**：自然语言 + 引导，不强求 JSON（R-G002）
3. **必须结构化**：prompt 定 JSON schema + few-shot；配 `fallback` 或 `createLlmRouterNode` + `routeFallback`（R-G006）
4. **手改 `graph.ts` 后必须回写 spec**（R-G003）

custom spec：`write` 含 `r.parsed` 才写 `"parse"`。范例：`_example.interview-agent.flow.json`。

### HITL 选型（三种机制，勿混用）

| 场景 | 机制 | Factory / 配置 |
|------|------|----------------|
| 副作用工具执行前（写盘 / bash / HTTP…） | ACP 弹窗，**turn 内、可多次** | 自动：`createToolExecNode` + `config/flow-agent.config.json` → `permissions` |
| 图内跨轮人审（草稿评审、大纲确认） | `interrupt` + 下轮用户消息 resume | `createHumanApprovalNode` → 常配对 `createApprovalFinalizeNode` |
| 图内秒级 yes/no（确认发布？） | 同步弹窗，**不结束 turn** | `createPermissionApprovalNode`（`onApprovalRequest`） |

> 工具审批由部署者配 `permissions.interruptOn`；流程弹窗由开发者在图里显式放节点。详见 `docs/node-catalog.md` HITL 类。

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

节点名 ≠ state channel 名（**R-G007**）。

### 条件边
```typescript
function routeAfterGrade(state): "rewrite" | "generate" {
  return state.relevant ? "generate" : "rewrite";
}
.addConditionalEdges("grade", routeAfterGrade, ["rewrite", "generate"])
```
> ⚠️ **condition 返回值必须 ∈ targets**（**R-G004**），否则运行时 LangGraph 抛 `Invalid edge`（静态反射 / `pnpm graph` 检不出，需人工核对）。
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
| ReAct | `toolsCondition` + `bindTools` | 默认图（`think` 只**决策** tool_calls，`tools` 节点才**执行**；见 `docs/flow-orchestration.md`） |
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
- ❌ `write` 不用 `r.parsed` 却配 `parse: parseJson`
- ❌ 图入口 LLM 强制 JSON、无 fallback
- ❌ 只改 `graph.ts` 不同步 `*.flow.json` spec
- ✅ 条件边纯函数 + 单测；`durableCheckpointer` 跨重启
- ✅ 结构化节点：prompt 定 schema + write 读 parsed +（可选）fallback
