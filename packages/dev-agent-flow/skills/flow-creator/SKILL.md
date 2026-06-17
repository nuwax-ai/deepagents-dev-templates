---
name: flow-creator
description: "创建全新 flow 的完整流程：State 定义 -> 节点 -> graph.ts -> 执行器包装 -> surface 挂接"
tags: [flow, creation, graph, nodes, surface, executor]
version: "2.0.0"
---

# Flow 创建器

## When to Use
需要创建一个全新的工作流 flow 时使用。创建前**先查阅 `flow-orchestration` 技能**，并**对照 `examples/` 选最接近的范例**。

## Step 1: 选型 — one-shot 还是 stateful

| 类型 | 场景 | seam | 示例 |
|------|------|------|------|
| `FlowExecutor` | 问答 / 检索 / 批处理（单输入单输出） | 函数 `(query, cb) => Promise<FlowResult>` | `examples/rag` |
| `StatefulFlow` | 审批 / 确认 / 长任务（HITL / 跨重启） | `createStatefulFlow(...)` | travel / pm / review / deep-research |

## Step 2: 读范例，在 src/app/ 实现

> ⚠️ **`examples/` 纯只读**。阅读范例学拓扑，然后在 **`src/app/`** 中实现（改 graph.ts、nodes/、tools/）。

开发位置 `src/app/`：
- `graph.ts` — 连线与条件路由（图是契约）
- `nodes/` — 节点实现（prepare / think / tools / respond）
- `tools/` — 内置工具（在此加新工具）

## Step 3: 写 State 定义

```typescript
import { Annotation } from "@langchain/langgraph";

const MyState = Annotation.Root({
  query: Annotation<string>,
  draft: Annotation<string>,
  feedback: Annotation<string>,     // interrupt 收集的用户回复
  output: Annotation<string>,
  // 并行写必须加 reducer
  findings: Annotation<Finding[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});
type MyStateType = typeof MyState.State;
```

## Step 4: 写节点函数

> **节点工厂模式**（默认图重构后的约定）：需运行时依赖的节点走工厂（create*Node(deps) 返回闭包）；纯节点直接导出函数。复杂 flow 把节点拆到 nodes/ 目录，在 graph.ts 聚合连线（照 src/app/nodes/ 模式）。

```typescript
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { requireModel, extractText, invokeWithResilience, resolveLlmResilience } from "../shared.js";
import { interrupt } from "@langchain/langgraph";

// compose：大模型写初稿
async function composeNode(state: MyStateType, appConfig?: AppConfig): Promise<Partial<MyStateType>> {
  const model = requireModel(appConfig, "my-flow 示例");
  const { longTimeoutMs } = resolveLlmResilience(appConfig);
  const res = await invokeWithResilience(model, [
    new SystemMessage("你是专业文案，根据要求写初稿。"),
    new HumanMessage(state.query),
  ], { timeoutMs: longTimeoutMs, label: "compose", config: appConfig });
  return { draft: extractText(res.content).trim() };
}

// review：interrupt 暂停等用户审阅
function reviewNode(state: MyStateType): Partial<MyStateType> {
  const feedback = interrupt({ question: `草稿：${state.draft}\n回复意见或「ok」` });
  return { feedback: String(feedback ?? "") };
}
```
> **shared.js**（`examples/shared.ts`）提供所有示例共用的工具函数，新 flow 直接 import：
> `requireModel`/`extractText`/`isApproval`（模型 + 文本 + 审批判定）
> `durableCheckpointer`（FileCheckpointSaver 跨重启持久化）
> `emitStage`/`emitPlan`/`emitTextToken`/`runTool`（阶段进度 / 结构化 Plan / 流式 token / 工具三态透出回调）
> `invokeWithResilience`/`resolveLlmResilience`（LLM 韧性：超时 + 重试）

## Step 5: 写连线（graph.ts）

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
> 节点名不能与 state channel 同名（draft channel -> 节点叫 compose）。

## Step 6: 包成执行器

### one-shot FlowExecutor
```typescript
import type { FlowExecutor } from "../../src/core/flow-types.js"  // 或兼容路径 surfaces/flow-types.js;

function buildMyFlow() {
  const executor: FlowExecutor = async (query, { onToken, onToolCall }) => {
    const res = await executeMyGraph(query, { config, callbacks: { onToken, onToolCall } });
    return { answer: res.answer };
  };
  return { executor, appConfig };
}
```
参考 `examples/rag/index.ts`。

### StatefulFlow（用 createStatefulFlow 基座）
```typescript
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import { durableCheckpointer } from "../shared.js";

export function createMyFlow(appConfig?: AppConfig): StatefulFlow {
  return createStatefulFlow<MyStateType>({
    buildGraph: (cp) => createMyGraph(appConfig, cp),    // 只需给编译函数
    toInput: (query) => ({ query }),                     // 新任务：query -> 初始 state
    toResult: (v) => ({ answer: v.output ?? "" }),       // 终态 -> 回答
    checkpointer: durableCheckpointer(appConfig),        // FileCheckpointSaver（跨重启）
  });
}
```
**禁止手写 run-loop** —— `createStatefulFlow` 统一处理 interrupt/resume + 持久化 + 递归护栏。
详见 flow-orchestration 技能的 createStatefulFlow 章节。

## Step 7: 挂接 surface（index.ts）

```typescript
import { config as loadDotenv } from "dotenv";
import { bootstrapFlowAcp } from "../../src/surfaces/acp/server.js";
import { runFlowCli } from "../../src/surfaces/cli/run.js";

const argv = process.argv.slice(2);
const isCli = argv.filter(a => !a.startsWith("-"))[0] === "myflow";

async function main() {
  loadDotenv();
  const { executor, appConfig } = buildMyFlow();  // one-shot
  // 或：const flow = createMyFlow(appConfig);       // stateful
  if (isCli) {
    await runFlowCli(executor, { query, interactive });
  } else {
    await bootstrapFlowAcp({ executor, appConfig, debug });
  }
}
main().catch(console.error);
```
surface 自动分流：function -> one-shot；对象（有 run）-> stateful HITL。

## Step 8: 补测试

决策函数（条件边路由）抽纯函数 + 单测：
```typescript
// tests/myflow.test.ts
import { describe, it, expect } from "vitest";
import { routeAfterGrade } from "../graph.js";

describe("routing", () => {
  it("relevant -> generate", () => {
    expect(routeAfterGrade({ relevant: true } as any)).toBe("generate");
  });
});
```
真实 LLM 调用用 `skipIf` 无凭证自动跳过。

## Anti-patterns
- 手写 run-loop（必须用 createStatefulFlow）
- 在 index.ts 里直接调 graph.invoke（必须经 bootstrapFlowAcp / runFlowCli）
- 节点名与 channel 同名
- 不给决策函数写单测
- ✅ 先对照 examples 选型再写
- ✅ 用 createStatefulFlow 处理 HITL
- ✅ surface 自动分流，不手动判断 flow 类型
