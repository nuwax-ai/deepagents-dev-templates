# Part 2：手写编排（bespoke 图）

> 所属：`flow-builder` L2-B。入口路由见 [SKILL.md](../SKILL.md)。验证见 [part4a-verify-debug.md](part4a-verify-debug.md)。

需要设计或创建工作流图时：状态定义、节点、边、条件路由、并行 Send、interrupt/resume HITL、子图、long-running pipeline。

**跑不通 / 节点未执行 / resume 失败** → 直接读 [part4a-verify-debug.md](part4a-verify-debug.md)。

## Step 1: 选型与对照

> **节点选型**：`docs/node-catalog.md` + `docs/node-kit.md`。

| 类型 | 场景 | seam（接入层） | 参考实现 |
|------|------|------|------|
| `FlowExecutor` | 问答 / 检索 / 批处理 | `(query, cb) => Promise<FlowResult>` | `src/libs/topologies/rag` |
| `StatefulFlow` | HITL / **durable stateful flow** 或 **conversational** | `createStatefulFlow(...)` | `src/libs/topologies/travel-planner` / `project-manager` / `human-in-loop`；default 等为 conversational |

开发位置：`src/app/graph.ts` + `src/app/nodes/` + `src/app/flow-tools.ts`；factory 来自 `src/libs/nodes/`，完整 topology 参考实现位于 `src/libs/topologies/`。

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

`createLlmNode` / `createLlmStreamNode` / `createLlmRouterNode` / `createMcpRetrievalNode` / `createHumanApprovalNode` / `createPermissionApprovalNode` / `createApprovalFinalizeNode` / `createToolExecNode` / `createFanout` / `createSubgraphNode` 等；bespoke 才在 `src/app/nodes/` 手写并说明原因。

### 流式输出（用户可见大段 LLM 文本 · 必读）

**铁律**：用户能直接看到的大段生成（`compose` / `aggregate` / `draft` / finalize 修订稿 / 报告正文）→ **`createLlmStreamNode`**，**禁止** `createLlmNode`。

| 对比 | `createLlmNode` | `createLlmStreamNode` |
|------|-----------------|----------------------|
| 模型调用 | `invoke()` 一次性 | `stream()` 逐 chunk |
| token 透出 | ❌ 无（ACP 仅 turn 末整段兜底） | ✅ `emitTextToken` → 客户端 |
| write 签名 | `r.content` / `r.parsed` | **`r.text`**（+ `r.streamed`） |
| 适用 | plan / grade / rewrite / 路由裁决 | 初稿、汇总、行程、修订稿 |

```typescript
const aggregate = createLlmStreamNode<MyStateType>({
  model: () => requireModel(appConfig, "my-flow"),
  prompt: (s) => [new SystemMessage("…"), new HumanMessage(material)],
  write: (r) => ({ output: r.text.trim() }),
  config: appConfig,
  label: "aggregate",
  timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs,  // 必填（长超时）
});
```

- **custom spec**：`"type": "llm-stream"`，`write` 用 `r.text`（**R-G009**；`generate.mjs` 生成前静态检）
- **`createApprovalFinalizeNode`**：`rejectedLlm.write` 同样读 **`r.text`**（框架内置 `createLlmStreamNode`）
- **ReAct 默认图**：`think` 走 messages 白名单另一条通路；勿与 topology 的 aggregate 节点混淆
- **降级**：无 `onToken` 或模型无 `.stream()` → 退回 invoke；ACP 终态仍整段兜底（目标项目 README § 流式输出检查清单）

详表 → 目标项目 `docs/node-kit.md` § createLlmStreamNode · **R-G009** · 本 Part § 流式输出。

### createLlmNode 与 parseJson

**硬规则见目标项目 `docs/flow-graph-rules.md`**（**R-G001 MUST**、**R-G002 SHOULD**、**R-G003 MUST**）。flow-builder 路由页：[flow-graph-rules-pointer.md](flow-graph-rules-pointer.md)。

摘要：

1. **仅当 `write` 读取 `r.parsed` 时才加 `parse: parseJson`**（R-G001）
2. **图入口 LLM**：自然语言 + 引导，不强求 JSON（R-G002）
3. **必须结构化**：prompt 定 JSON schema + few-shot；配 `fallback` 或 `createLlmRouterNode` + `routeFallback`（R-G006）
4. **手改 `graph.ts` 后必须回写 spec**（R-G003）

custom spec：`write` 含 `r.parsed` 才写 `"parse"`。范例：`_example.interview-agent.flow.json`。

### HITL 选型（四种机制，勿混用）

| 场景 | 机制 | Factory / 配置 |
|------|------|----------------|
| 副作用工具执行前（写盘 / bash / HTTP…） | ACP 弹窗，**turn 内、可多次** | 自动：`createToolExecNode` + `config/flow-agent.config.json` → `permissions` |
| 图内跨轮人审（纯文本：说意见或 ok） | `interrupt` + 下轮用户消息 resume | `createHumanApprovalNode` → 常配对 `createApprovalFinalizeNode` |
| 图内跨轮人审（**固定字段表单**） | **平台问答卡片**（ask-question MCP 展示）+ `interrupt` 收回复 | `present_review`：`createAskQuestionPresentationNode`（`human-in-loop/graph.ts`）→ `review`：`createHumanApprovalNode` + `normalizeReviewFeedback` → `createApprovalFinalizeNode` |
| 图内秒级 yes/no（确认发布？） | 同步弹窗，**不结束 turn** | `createPermissionApprovalNode`（`onApprovalRequest`） |

> **平台问答卡片** = **主平台的问答卡片**（模板术语，见目标项目 `docs/glossary.md`）。它是 UI 展示层；**durable resume 仍靠 `interrupt`**，不是 MCP 工具替代品。
>
> **两节点范式（必拆）**：`present_review`（MCP 调 ask-question，工具返回 `pending`）与 `review`（`interrupt`）必须分开——MCP 不维护 LangGraph checkpoint；resume 时只重跑 `review`，避免重复弹表单。权威：`src/libs/topologies/human-in-loop/`。
>
> 工具审批由部署者配 `permissions.interruptOn`；流程弹窗由开发者在图里显式放节点。详见 `docs/node-catalog.md` HITL 类。

```typescript
// 纯文本人审（travel-planner confirm / pm approve 等）
function reviewNode(state: MyStateType): Partial<MyStateType> {
  const feedback = interrupt({ question: `草稿：${state.draft}\n回复意见或「ok」` });
  return { feedback: String(feedback ?? "") };
}

// 结构化表单人审（human-in-loop）：present_review → review 两节点，勿合并
// present_review = createAskQuestionPresentationNode(findAskQuestionTool(allTools))
// review = createHumanApprovalNode({ write: (fb) => ({ feedback: normalizeReviewFeedback(fb) }) })
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

**one-shot** → `FlowExecutor`。**有状态** → `createStatefulFlow`（禁止手写 run-loop；dev-agent `stateful-custom` 例外）。

**两种 StatefulFlow 用法**（详见目标项目 README § 两类 flow）：

| 模式 | 配置 | 行为 |
|------|------|------|
| **HITL durable stateful flow**（默认） | 默认 | 暴露 `hasStarted`；首条 `query` 开题 → 后续 `resume` 同一任务（**one session, one topic**）；`durableCheckpointer` 支持 **cross-restart resume** |
| **conversational** | `conversational: true` | 不暴露 `hasStarted`；surface 每轮 `query` + 稳定 threadId + checkpointer → 多轮记忆；`graph.stream` 真流式（如 default / search-aggregator） |

## Step 6: Surface

`bootstrapFlowAcp` / `runFlowCli` 自动分流 one-shot vs stateful。

## 编排模式速查

| 模式 | 关键 API | 范例 |
|------|----------|------|
| ReAct | `toolsCondition` + `bindTools` | 默认图（`think` 只**决策** tool_calls，`tools` 节点才**执行**；见 `docs/flow-orchestration.md`） |
| 条件重试 | `addConditionalEdges` | `src/libs/topologies/rag` |
| Send 并行 | `Send` + reducer | `src/libs/topologies/travel-planner`（**aggregate 用 createLlmStreamNode**；**research 接平台搜索 MCP**） |
| reflection | `createLlmRouterNode` 或条件边 | pm / deep-research |
| HITL | `interrupt` + resume | `src/libs/topologies/human-in-loop`（**compose 流式初稿 + 平台问答卡片 present_review（可选）**）；纯文本门控见 travel/pm |
| **Durable stateful flow** | `onStage` + checkpoint | `src/libs/topologies/deep-research`（**draft 流式**） |
| **流式用户可见输出** | **`createLlmStreamNode`** | travel aggregate / human-in-loop compose / rag generate |

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
- ❌ **用户可见大段输出**用 `createLlmNode` 或 spec 写 `r.content`（应 `createLlmStreamNode` + `r.text`，**R-G009**）
- ✅ 条件边纯函数 + 单测；`durableCheckpointer` 跨重启
- ✅ 结构化节点：prompt 定 schema + write 读 parsed +（可选）fallback
