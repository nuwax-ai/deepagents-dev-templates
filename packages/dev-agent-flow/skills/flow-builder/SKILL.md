---
name: flow-builder
description: "deepagents-flow-ts 目标模板项目的工作流设计与编排：State -> factory -> graph 连线 -> 执行器 -> surface；编排模式 ReAct/HITL/Send/子图/流水线；Step 7 为 .logs/ 调试日志与运行时验证（系统提示词 DEBUG_LOGS 的详细指引）。LangGraph API 用 Context7 查"
tags: [flow, orchestration, stategraph, hitl, send, creation, graph, nodes, debug, logs, deepagents-flow-ts]
version: "1.1.0"
---

# Flow 设计与编排（deepagents-flow-ts）

## When to Use
需要设计或创建工作流图时：状态定义、节点、边、条件路由、并行 Send、interrupt/resume HITL、子图、长任务流水线。

**运行时 / ACP / HITL / 图执行排查**（跑不通、节点未执行、resume 失败等）：直接跳到 **Step 7** — 本技能是系统提示词 `<DEBUG_LOGS>` 的详细操作指引。

> LangGraph/LangChain API 细节（`Annotation.Root`、`Send`、`interrupt`、`Command`、`StateGraph` 等）用 Context7 查最新文档：`resolve-library-id("langgraph")` → `query-docs`。本技能聚焦 `deepagents-flow-ts` 目标模板项目的结构约定与编排模式。

## Step 1: 选型与对照

| 类型 | 场景 | seam | 范例 |
|------|------|------|------|
| `FlowExecutor` | 问答 / 检索 / 批处理 | 函数 `(query, cb) => Promise<FlowResult>` | `examples/rag` |
| `StatefulFlow` | 审批 / 确认 / HITL / 跨重启 | `createStatefulFlow(...)` | travel / pm / review / deep-research |

> **examples/ 纯只读**。读范例学拓扑，在 **`src/app/`** 实现默认图（改 graph.ts 连线、nodes/ 节点、flow-tools.ts 工具装配）。通用工具放 `src/libs/tools/`，可复用节点优先用 `src/libs/nodes/` factory。

开发位置：`src/app/graph.ts`（连线）+ `src/app/nodes/`（默认图节点）+ `src/app/flow-tools.ts`（工具装配）；可复用节点来自 `src/libs/nodes/`。

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

> **节点 factory 优先**：先查 `docs/node-kit.md` 和 `src/libs/nodes/` 的 createLlmNode/createToolExecNode/createHumanApprovalNode/createFanout 等 factory；只有 bespoke 场景才在 `src/app/nodes/` 手写节点，并说明为什么不用 factory。

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

## Step 7: 验证与调试日志（`.logs/`）

> **`<DEBUG_LOGS>` 详细指引**：系统提示词只规定「必须先读日志」；本 Step 为完整操作路径（约定、命令、六步排查法）。

编排完成后，除编译/测试外，**运行时问题必须读项目根真实调试日志**。

### 日志约定

| 项 | 约定 |
|----|------|
| 目录 | `<REPO>/.logs/`（`LOG_DIR=<REPO>/.logs`） |
| 配置 | 本地 ACP/Zed 见 `docs/zed-debug.md`：`LOG_LEVEL=debug` + `LOG_DIR` |
| 文件名 | `<agentName>-<sessionId>-<YYYY_MM_DD>.log` |
| 实现 | `src/runtime/logger.ts` — session 启动时写入，stdout 与文件双写 |

未设 `LOG_DIR` 时可能回退 `~/.flowagents/logs/`；**开发排查优先查项目根 `.logs/`**（已在 `.gitignore`，勿提交）。

### 常见日志前缀（过滤用）

- `runtime:flow-graph` — 图编译、节点调度、边路由
- `runtime:<flow名>` — 各 flow 生命周期（如 travel、rag）
- `[logger]` — session 初始化、日志文件路径
- `error` / `warn` — 优先排查

### 验证命令

```bash
pnpm build
pnpm test                    # 含 tests/layering.test.ts
pnpm typecheck
pnpm smoke:acp               # 或 pnpm smoke:<example>
pnpm graph                   # 导出拓扑
```

### 读日志排查（编排相关场景）

图跑不通、节点未执行、条件边走错、HITL 不 resume、ACP 无响应时：

1. **确认** — 调试 env 含 `"LOG_DIR": "<REPO>/.logs"`，`LOG_LEVEL` 足够（HITL/ACP 用 `debug`）
2. **复现** — Zed / `pnpm smoke:*` / CLI 触发一次失败路径
3. **定位** — `.logs/` 取最新 `.log`，或按 sessionId / agent 名匹配
4. **过滤** — 搜 `error`、`warn`、`interrupt`、`onPrompt`、节点名、tool 名；对照 graph 执行顺序与 HITL 轮次
5. **修复验证** — 改图/节点/配置后重跑，新日志中确认错误消失
6. **记录** — 稳定根因与修复点写入 `project.md`（只写摘要，不粘贴整段 `.log`）

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
- ❌ 不看 `.logs/` 就猜测 ACP/HITL/图执行行为（必须先读项目根调试日志）
- ✅ 条件边抽纯函数 + 单测
- ✅ HITL 用 createStatefulFlow（buildGraph/toInput/toResult）
- ✅ reflection 回边加 recursionLimit 护栏
- ✅ 生产传 durableCheckpointer（跨重启续跑）
