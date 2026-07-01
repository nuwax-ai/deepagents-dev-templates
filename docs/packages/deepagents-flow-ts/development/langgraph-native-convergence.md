# LangGraph 原生对象收敛开发方案

本文档记录 `deepagents-flow-ts` 将自造执行/事件机制逐步收敛到 LangGraph 原生对象的开发计划。

核心目标：保持 **workflow-first** 架构，图本身就是请求路径。不要在图之上再造 `FlowEvent`、`Flow` 等黑盒抽象；surface 应直接 stream 编译后的 LangGraph 图，并消费原生 `[mode, chunk]`。

## 0. 实施状态（2026-06-16）

### ✅ 已完成的收敛

- **MCP 层 → `@langchain/mcp-adapters`**（本次去 `deepagents-app-ts` 依赖时完成）：自造 `MCPManager` 替换为原生 `MultiServerMCPClient` + `getTools()`；保留三层合并语义（`default < platform < session`，session-wins）+ `configPath` 文件加载 + `onConnectionError: "warn"` 容错 + `destroyRuntimeContext` 释放连接。见 `src/vendor/runtime/runtime-context.ts`。
- **已用原生**：`StateGraph`、`Annotation.Root`、`ToolNode`、`toolsCondition`、`interrupt`、`Command(resume)`、`Send`、`getGraphAsync`、checkpointer 协议（`FileCheckpointSaver` 实现协议）、`bindTools`、`trimMessages`。
- **保留（无原生等价）**：`FileCheckpointSaver`（零依赖文件持久化；官方无文件 saver）。

### ⬜ 未实施（开发计划，按优先级 / 风险排序）

| 优先级 | 项 | 现状（已核实） | 阶段 | 风险 |
| --- | --- | --- | --- | --- |
| P0 | **C** compaction `trimMessages` tokenCounter | `compaction.ts:90` 仍用 `estimateTokens`；有凭证时应优先用 `model` 作 tokenCounter | 阶段一 | 低 |
| P0 | **A** state `MessagesAnnotation.spec` | `state.ts:18-21` 仍手写 `messagesStateReducer`；应展开 `...MessagesAnnotation.spec` | 阶段一 | 低 |
| P1 | **E** examples `retryPolicy`/`timeout` | examples 用 `withRetry`/`withTimeout`；需先 spike `addNode({retryPolicy,timeout})` 类型 | 阶段一后半 | 中 |
| P2 | **B** surface 多模式 stream | surface 走自造回调（onToken/onToolCall/onStage）；应 `streamMode:["messages","tools","custom","updates"]` | 阶段二 | 高（架构级） |

**推荐执行顺序**：C → A（阶段一，单文件可独立回滚）→ E spike → E 扩展 → B（默认 flow → stateful → examples 分批）。

> 注：去 `deepagents-app-ts` 依赖（vendor runtime + MCP mcp-adapters）与本收敛计划正交——vendor 提供的自包含 `resolveModel`/`logger` 正好供 C（model tokenCounter）和 B（surface stream）使用。

---

## 1. 背景与原则

当前模板已经大量使用 LangGraph 原生能力：`StateGraph`、`Annotation.Root`、`ToolNode`、`toolsCondition`、`interrupt`、`Command`、`Send`、`getGraphAsync`、checkpointer 协议等。需要收敛的不是“所有本地代码”，而是那些功能语义已经由 LangGraph 提供、且继续自造会让 surface 与图运行时脱节的部分。

实施原则：

- **图优先**：节点、边、条件路由、stream 事件都从 LangGraph 图流出。
- **薄 surface**：ACP/CLI 只做协议映射和展示，不负责执行语义。
- **分阶段**：先做低风险状态/压缩调整，再验证节点 retry/timeout，最后迁 surface streaming。
- **不机械替换**：只有语义等价的自造逻辑才替换；文件型 checkpoint saver 暂时保留。
- **版本优先**：实施时以当前锁定的 `@langchain/langgraph@1.4.1` 类型和行为为准，文档片段只能作方向参考。

## 2. 当前自造点与处置

| 编号 | 当前实现 | LangGraph 原生能力 | 处置 |
| --- | --- | --- | --- |
| A | `src/app/state.ts` 手写 `messages` reducer | `MessagesAnnotation.spec` | 阶段一 |
| C | `compactHistory` 用 `estimateTokens` 作为裁剪计数 | `trimMessages({ tokenCounter: model })` | 阶段一 |
| E | examples 里的 LLM 调用 `withRetry` / `withTimeout` | `addNode(..., { retryPolicy, timeout })` | 阶段一后半，先 spike |
| B | `onToken` / `onToolCall` / `onStage` 回调穿透 | `streamMode: ["messages", "tools", "custom", "updates"]` | 阶段二 |
| D | `FileCheckpointSaver` 文件 JSON 持久化 | 官方 Memory/Sqlite/Postgres/Redis saver | 保留 |

保留 `FileCheckpointSaver` 的原因：官方没有零依赖文件 saver；当前模板需要 bundle 干净、跨重启可续跑、无需数据库。它实现的是官方 checkpointer 协议，不是替代 LangGraph runtime。

## 3. 阶段一：A + C

阶段一只改状态定义和压缩 token 计数，不触碰 surface streaming。

### A. 使用 `MessagesAnnotation.spec`

目标文件：

- `src/app/state.ts`
- `examples/dev-agent/researcher.ts`

只替换真正的 `messages` channel：

```ts
import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

const lastValue = <T>(_: T, next: T): T => next;

export const FlowStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  input: Annotation<string>({ value: lastValue<string>, default: () => "" }),
  output: Annotation<string>({ value: lastValue<string>, default: () => "" }),
  steps: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
});
```

不要机械替换这些字段：

- `examples/rag/graph.ts` 的 `history: Annotation<BaseMessage[]>`：它是 RAG 输入历史，不是 LangGraph 主 `messages` channel。
- travel / pm / review / deep-research 里的业务状态：这些图没有通用 `messages` reducer，不能强行展开 `MessagesAnnotation.spec`。
- tests 里的 toy state：测试通常在覆盖局部语义，除非确实手写了 `messagesStateReducer`。

验收点：

- 删除不再需要的 `messagesStateReducer` / `BaseMessage` import。
- `compactionUpdate` 的 `RemoveMessage` 替换模式仍能作用于 `MessagesAnnotation` channel。
- `pnpm typecheck` 和 `pnpm test` 通过。

### C. `trimMessages` 优先使用模型 tokenCounter

目标文件：

- `src/app/compaction.ts`

保留 `estimateTokens`，但区分两个用途：

- 触发判定：继续使用 `estimateTokens(messages)`，避免无凭证或 token counting 慢调用影响是否压缩。
- 无凭证 fallback：继续使用 `estimateTokens`。
- 有凭证且解析到模型：优先把 model 作为 `trimMessages` 的 `tokenCounter`。

推荐实现形状：

```ts
const raw = hasModelCredentials(config) ? resolveModel(config) : null;
const model = raw && typeof raw !== "string" ? raw : null;
const tokenCounter = model ?? ((msgs: BaseMessage[]) => estimateTokens(msgs));

const recent = await trimMessages(messages, {
  maxTokens: cc.keepRecentTokens,
  strategy: "last",
  tokenCounter,
  includeSystem: true,
});
```

注意事项：

- 如果 TypeScript 类型不接受当前 model 作为 `tokenCounter`，先写窄类型适配，不要用大范围 `any` 抹掉错误。
- 如果运行时发现模型不支持 token counting，应 catch 后回退 `estimateTokens` 再 trim。
- 摘要 LLM 调用仍使用同一个已解析模型，避免重复 `resolveModel(config)`。

验收点：

- 有凭证路径优先精确裁剪。
- 无凭证路径不调模型。
- 摘要失败仍返回 recent，不中断图执行。

## 4. 阶段一后半：E 的 API spike

`withRetry` / `withTimeout` 不要一刀切删除。先验证当前 LangGraph JS 版本的节点级配置，再替换语义安全的位置。

目标范围：

- `examples/deep-research/graph.ts` 的 LLM 节点。
- 后续再看 `examples/travel-planner/graph.ts`、RAG 检索节点等。

先做一个最小 spike：

```ts
const graph = new StateGraph(ResearchState)
  .addNode("plan", planNode, {
    retryPolicy: {
      maxAttempts: 3,
      initialInterval: 1000,
      retryOn: (err) => isTransientLlmError(err),
    },
    timeout: {
      runTimeout: LLM_TIMEOUT_MS,
    },
  });
```

这里的 `timeout` 字段必须以本地类型检查为准。LangGraph 文档里存在 `idleTimeout`、`runTimeout`、`refreshOn` 等概念；但原 `withTimeout(m.invoke(...))` 是“单次 LLM 调用墙钟上限”，更接近 `runTimeout`，不一定等价于 `idleTimeout`。

替换规则：

- 节点主要工作就是一次 LLM 调用，且重试整个节点没有副作用：可以迁到 `addNode`。
- 节点内部已经 catch 并降级：只有会抛出的错误才会触发 `retryPolicy`，不要以为配置了 retry 就覆盖内部降级。
- 节点包含外部写操作、非幂等平台调用、会重复发用户可见事件：不要整节点重试，保留局部 retry 并加注释。
- MCP 检索、HTTP 请求、bash 工具这类外部 IO 的单次超时护栏可以保留；它们不是 LangGraph LLM 节点 retry 的替代对象。

验收点：

- `pnpm typecheck:examples` 验证 `retryPolicy` / `timeout` 形状。
- 用一个测试或 smoke 证明 LLM 节点抛 transient error 时会重试。
- 不把 `runTool` / MCP 请求超时误删。

## 5. 阶段二：B surface 直接 stream 图

阶段二是架构级迁移。目标是删除自造回调传递，让 ACP/CLI 直接消费 LangGraph 多模式 stream。

### 5.1 新 flow 契约

替换当前 `FlowExecutor` / `StatefulFlow.run(callbacks)` 的回调式 surface 契约，统一成“图 + 输入/输出转换”。

建议内部类型：

```ts
export interface GraphFlow<S = unknown> {
  buildGraph(checkpointer?: BaseCheckpointSaver): RunnableGraph;
  toInput(query: string): Record<string, unknown>;
  toResume?(text: string): Command;
  toResult(values: S): { answer: string; footer?: string };
  configurable?: Record<string, unknown>;
  recursionLimit?: number;
}
```

这个类型只是 surface 内部薄契约，不是新的执行抽象。执行仍然是 `graph.stream(...)`。

第一步必须先改默认 flow：

- `src/app/default-flow.ts` 不再返回 `FlowExecutor`。
- `src/app/graph.ts` 提供 `createFlowGraph` + `toInput` + `toResult` 可用组合。
- 原 `executeFlow()` 可以删除或仅保留给测试，但 surface 不再走它。

### 5.2 多模式 stream

ACP/CLI 统一使用：

```ts
const stream = await graph.stream(input, {
  streamMode: ["messages", "tools", "custom", "updates"],
  configurable: {
    ...flow.configurable,
    thread_id: sessionId,
  },
  recursionLimit: flow.recursionLimit,
  durability: "sync",
});

for await (const [mode, chunk] of stream) {
  // mapStreamChunk(mode, chunk)
}
```

必须先写 `mapStreamChunk(mode, chunk)` 单测。它是 surface 内部纯函数，负责把 LangGraph 原生事件翻译成 ACP/CLI 最小展示结构，不对外暴露。

建议内部归一结构：

```ts
type SurfaceStreamEvent =
  | { type: "text"; text: string }
  | { type: "tool_start"; id: string; name: string; input?: unknown }
  | { type: "tool_update"; id: string; status: "completed" | "failed"; output?: unknown; error?: string }
  | { type: "stage"; stage: string; index?: number; total?: number; detail?: string }
  | { type: "interrupt"; question: string };
```

注意：这不是对外抽象层，只是避免 ACP 和 CLI 各写一遍脆弱的 payload 判断。

### 5.3 stream mode 映射

`messages`：

- payload 通常为 `[messageChunk, metadata]`。
- 按 `metadata.langgraph_node` 过滤回答节点，避免把规划、评分、工具前置 LLM 的 token 全吐给用户。
- 如果模型不支持 token streaming，最后用 `graph.getState()` 补最终 answer。

`tools`：

- 来自 `ToolNode` 或 LangGraph runnable tool 生命周期。
- 先用测试确认当前版本事件形状，再映射到 `tool_call` / `tool_call_update`。
- 不要假设它天然等于当前 `ToolCallEvent`。

`custom`：

- 自定义节点用 `config.writer(...)` 发进度或非 ToolNode 的工具事件。
- 统一 payload 结构：

```ts
config.writer({
  type: "stage",
  stage: "调研",
  detail: section.title,
});

config.writer({
  type: "tool",
  status: "in_progress",
  id,
  name: "web_search",
  input: { query },
});
```

`updates`：

- 用于状态更新和 interrupt 检测。
- 当前代码用 `INTERRUPT` 常量从普通 stream chunk 读取；多模式后必须确认 `chunk` 形状。
- 检测到 interrupt 后 ACP 发 question 并 `end_turn`，CLI 则提示用户输入 resume。

### 5.4 节点侧清理

默认图：

- `tools` 节点不再手动调用 `callbacks.onToolCall`。
- 直接使用 `ToolNode` 结果和 `tools` stream mode。
- `respond` 只写 `output` / `steps`，不再手动 `onToken`。

stateful 基座：

- 不再注入 `onToolCall` / `onStage`。
- 保留 `appConfig`、`thread_id`、`recursionLimit`、checkpointer。
- 有状态判断仍通过 `graph.getState()`。

examples：

- `emitStage(config, ...)` 改成 `config.writer({ type: "stage", ... })`。
- 走 `ToolNode` 的工具不手动发事件。
- 自定义检索节点继续用 `custom` 发工具事件。
- RAG、travel、deep-research 这类自定义 MCP 调用不要强行改成 `tools` mode，除非真的迁成 LangChain Tool + ToolNode。

## 6. 推荐实施顺序

1. 新增本文档并链接入口。
2. 阶段一 A：`MessagesAnnotation.spec`。
3. 阶段一 C：`trimMessages` tokenCounter 优先用模型。
4. 阶段 E spike：确认 `retryPolicy` / `timeout` 类型与行为。
5. 阶段 E 扩展：只替换安全的 LLM 节点。
6. 阶段 B-1：默认 flow direct stream。
7. 阶段 B-2：`createStatefulFlow` direct stream。
8. 阶段 B-3：逐个迁 examples 和测试。

每一步都必须能独立回滚，不能在同一个提交里混入低风险状态调整和 surface 架构迁移。

## 7. 验证矩阵

阶段一：

```bash
pnpm typecheck
pnpm typecheck:examples
pnpm test
pnpm graph
```

阶段 E：

```bash
pnpm typecheck:examples
pnpm test -- examples/deep-research
```

阶段 B：

```bash
pnpm test
pnpm smoke
pnpm smoke -- --example rag
pnpm smoke -- --example travel
pnpm smoke -- --example pm
pnpm smoke -- --example review
pnpm smoke -- --example research
pnpm exec tsx src/index.ts flow -i
```

手动验收：

- 默认 flow 能逐 token 或至少增量输出。
- ToolNode 工具事件从 `tools` mode 流出。
- 自定义检索节点的工具事件从 `custom` mode 流出。
- HITL interrupt 和 resume 仍可跨进程恢复。
- 无模型凭证 fallback 仍可跑默认 flow。

## 8. 风险与回滚

主要风险：

- `MessagesAnnotation.spec` 被误用到非 `messages` channel，导致业务状态结构变化。
- `trimMessages` 的 `tokenCounter` 类型与当前模型对象不兼容。
- 节点级 timeout 语义与原 `withTimeout(m.invoke(...))` 不等价。
- `tools` stream payload 与当前 `ToolCallEvent` 字段不一致。
- 多模式 stream 下 interrupt payload 包装层变化。
- 将手动回调删除过早，导致 ACP/CLI 无 token、无工具进度或无 HITL 问题。

回滚策略：

- A/C 回滚单文件即可。
- E 若行为不稳定，保留节点 `retryPolicy` spike 结论，恢复局部 `withRetry` / `withTimeout`。
- B 必须按默认 flow、stateful 基座、examples 分批提交；某个 example 失败时只回滚该 example 的 stream 迁移，不影响默认 flow。

## 9. 文档同步清单

实施完成后同步更新：

- `README.md`：删除 `FlowExecutor` / callbacks 叙述，改为 direct graph stream。
- `CLAUDE.md`：更新保护区规则；本次重构获得授权后 `src/surfaces/` 可改。
- `packages/deepagents-flow-ts/docs/flow-patterns.md`：把 `onStage` / `withTimeout` 描述改成 `config.writer` / node policy。
- examples README：更新运行与事件展示说明。
