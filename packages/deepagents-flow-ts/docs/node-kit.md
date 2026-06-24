# node-kit —— 节点 factory catalog

> **选型先看 [node-catalog.md](node-catalog.md)**(有哪些节点类型 + 何时选 + 节点级 DSL 的 `type` 词表);本文件是各 factory 的 **API / 用法详情**。
>
> **建 flow 必读**。`src/libs/nodes/` 把 LangGraph 常见节点模式做成**参数化节点 factory**——
> 你拼图时优先 `addNode("x", createYyyNode({...}))`,不再每个节点手写 `async (state) => ...` 体。
> factory 泛型于 State(`S`),用 `prompt(state)`/`write(result, state)` 回调解耦具体 state 形状。

```ts
import {
  createLlmNode, createLlmStreamNode, createToolExecNode,
  createHumanApprovalNode, createApprovalFinalizeNode, createLlmRouterNode,
  createPrepareNode, createFanout, createSubgraphNode, createMcpRetrievalNode,
  // 原语(bespoke 节点也可用)
  extractText, parseJson, emitStage, emitPlan, emitTextToken, runTool, isApproval, streamLLMText,
} from "../libs/nodes/index.js";
```

## 何时用哪个

| 场景 | factory | 例 |
|---|---|---|
| 一次调 LLM,写回文本 | `createLlmNode` | compose/aggregate |
| 一次调 LLM,写回**结构化** JSON | `createLlmNode({ parse })` | plan/rewrite |
| LLM 裁决 → **Command goto** 路由(reflection/evaluator) | `createLlmRouterNode` | deep-research outline_review/quality_review |
| **流式**调 LLM,逐 token 给用户 | `createLlmStreamNode` | draft/respond |
| 执行模型 `tool_calls`(ReAct 工具步) | `createToolExecNode` | 默认图 tools |
| **主动 MCP 检索**(stdio,rateLimited+三态) | `createMcpRetrievalNode` | travel research / rag retrieve |
| 人审门(前置):`interrupt` 暂停 → 通过/打回 | `createHumanApprovalNode` | review/approve/confirm/clarify |
| HITL 后置定稿:按 feedback 短路/LLM 修订 | `createApprovalFinalizeNode` | human-in-loop/travel/pm finalize |
| input → 首条 HumanMessage | `createPrepareNode` | 默认图 prepare |
| 并行扇出(Send map-reduce) | `createFanout` | travel/deep-research research |
| 把一张小图当节点用 | `createSubgraphNode` | dev-agent researcher |

> **bespoke 不要硬塞**:isApproval 短路定稿、LLM 裁决路由、主动 MCP 检索**已有 factory**(见下各节);剩余真正 bespoke(如 deep-research converse 的 interrupt 路由、RAG retrieve 的意图驱动多工具并行、adaptive-rag 的逐项 LLM 评分 grade_documents / grade_generation 与原生 `webSearchTool` 调用、文件交付)才保留手写,见各 example「保留 bespoke」注释。

---

## createLlmNode —— 一次调 LLM

```ts
const compose = createLlmNode<MyState>({
  model: () => requireModel(appConfig, "我的 flow"),       // 或静态 model 实例;返回 null 触发 fallback
  prompt: (s) => [new SystemMessage("..."), new HumanMessage(s.query)],
  write: (r, s) => ({ draft: r.content.trim() }),          // r = { content, parsed? }
  config: appConfig, label: "compose",                      // 可选
  timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs, // 可选;默认 short
  // 结构化输出:把 LLM 文本 parse 成对象,write 经 r.parsed 取
  // parse: (text) => parseJson<Task[]>(text),
  // fallback: (s, reason, err) => ({ draft: "(生成失败)" }),  // 无模型/调用失败的降级
});
graph.addNode("compose", compose);
```

- `r.content` 已是 `extractText` 后的纯文本;`parse` 提供时 `r.parsed = parse(content)`。
- **结构化**:加 `parse`(常用 `parseJson`),`write` 里读 `r.parsed`。PM 的 plan/evaluate、rag 的 rewrite 都用这个。
- **`write` 可收第三参 `config?`**(LangGraphRunnableConfig)——供 write 内发 `emitPlan(config,…)`/`emitStage(config,…)` 副作用;不用就忽略(默认两参 `(r, s)`)。
- 例:[human-in-loop](../examples/human-in-loop/) compose、[travel-planner](../examples/travel-planner/) aggregate、[project-manager](../examples/project-manager/) plan/estimate/evaluate、[rag](../examples/rag/) rewrite、[adaptive-rag](../src/libs/topologies/adaptive-rag/) route_question / transform_query（`{ parse }` 结构化裁决 / 查询重写）。

## createLlmStreamNode —— 流式 LLM

```ts
const draft = createLlmStreamNode<MyState>({
  model: () => requireModel(appConfig, "..."),
  prompt: (s) => [new SystemMessage("..."), new HumanMessage(material)],
  write: (r, s) => ({ draft: r.text, draftStreamed: r.streamed }),  // r = { text, streamed }
  timeoutMs: llmLongTimeout(appConfig),                     // 流式需显式(长)超时
  // fallback: (s) => ({ draft: s.draft || 复用上版 }),        // 流式失败降级
});
```

- 只用于**用户可见的大段输出**:有 `onToken` sink 且模型支持 stream 时逐 chunk `emitTextToken`,否则退回一次性 invoke(`r.streamed=false`)。
- 例:[deep-research](../examples/deep-research/) draft(带「失败复用上版草稿」fallback)。

## createLlmRouterNode —— LLM 裁决 → Command goto

```ts
const grade = createLlmRouterNode<MyState>({
  model: () => requireModel(appConfig, "grade"),
  prompt: (s) => [new SystemMessage("评审，只输出 JSON {verdict,critique}"), new HumanMessage(s.draft)],
  parse: (t) => parseJson<{ verdict?: string; critique?: string }>(t),
  route: (parsed, s) => {
    const v = parsed as { verdict?: string };
    const update = { verdict: v.verdict ?? "pass" };
    return { goto: v.verdict === "fail" ? "redo" : "__end__", update };  // goto 节点名或 "__end__"
  },
  routeFallback: (s) => ({ goto: "__end__", update: { verdict: "pass" } }),  // 无模型/失败/parse 失败 → 放行兜底（防死循环）
  config: appConfig, label: "grade",
});
```

- createLlmNode 的「路由变体」:成功走 `route`、失败(无模型/error/parse)走 `routeFallback`,都返回 `{goto, update}` → 包成 `Command`(`.goto` 是数组,如 `["redo"]`)。
- 与「外部纯函数条件边」互补:那条是 `addConditionalEdges` + `routeAfterXxx` 纯函数;本 factory 是**节点内** Command goto(reflection/evaluator 模式)。`route` 内常调 `routeAfterXxx({...s, ...update})` 算 goto。
- 例:[deep-research outline_review/quality_review](../src/libs/topologies/deep-research/nodes/review.ts)。

## createToolExecNode —— 执行 tool_calls

```ts
const tools = createToolExecNode<MyState>({
  tools: allTools,                  // StructuredTool[](与 think bindTools 同一组)
  callbacks,                        // 可选;透出 onToolCall 三态(in_progress→completed/failed)
  // write: (msgs, s) => ({ messages: msgs, steps: msgs.map(t => `tool:${t.name}`) }),  // 默认 {messages}
});
```

- 包 prebuilt `ToolNode`;自动发 in_progress(每个 tool_call)→ completed/failed(每个 ToolMessage)。
- 默认写 `{ messages }`;需额外字段(如 `steps`)传 `write`。
- 例:**默认图** tools 节点([src/app/graph.ts](../src/app/graph.ts))。

## createMcpRetrievalNode —— 主动 MCP 检索

```ts
const research = createMcpRetrievalNode<MyState>({
  mcpServers: { context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] } },
  retrieve: (s) => ({ server: "context7", tool: "query-docs", args: { libraryId: "/langchain-ai/langgraph", query: s.currentAspect } }),
  write: (r, s) => ({ findings: [{ aspect: s.currentAspect, suggestion: r.ok ? r.text.slice(0, 800) : `（失败：${r.text}）` }] }),
  // rateLimited?: true（默认;Send 扇出必备）;timeoutMs?: 20000
});
```

- 与 createToolExecNode 互补:后者执行模型 tool_calls(ToolNode 模式);本 factory 是**主动检索**——节点自己决定调哪个 MCP server 的哪个 tool(RAG/调研)。内部 `rateLimited` 节流 + `runTool` 三态透出。
- 多源并行取优(如 deep-research Context7 ∥ DDG + 启发式合并)**不收口**——保留 bespoke subgraph。
- 例:[travel-planner research](../src/libs/topologies/travel-planner/graph.ts)。

## createHumanApprovalNode —— HITL 人审

```ts
// 简单:interrupt → 写 feedback
const review = createHumanApprovalNode<MyState>({
  question: (s) => `📝 草稿:${s.draft}\n说修改意见,或回「ok」通过`,
  write: (feedback) => ({ feedback }),   // 默认 { feedback }
});

// 路由变体:人审 → 通过/打回,返回 Command(动态多分支)
const gate = createHumanApprovalNode<MyState>({
  question: (s) => `📋 大纲:${s.outline}\n确认或提意见`,
  route: (approved, feedback, s) =>
    approved
      ? new Command({ goto: "next", update: { decision: "ok" } })
      : new Command({ goto: "plan", update: { critique: feedback } }),
});
```

- `interrupt` 暂停、`isApproval(feedback)` 判定(默认中英文通过词;`regex` 可覆盖)。空回复视为通过。
- `write`(简单写回)或 `route`(Command 路由)二选一。
- 例:[human-in-loop](../examples/human-in-loop/) review、[travel-planner](../examples/travel-planner/) confirm、[project-manager](../examples/project-manager/) approve、[deep-research](../examples/deep-research/) clarify/outlineGate。

## createApprovalFinalizeNode —— HITL 后置定稿

```ts
const finalize = createApprovalFinalizeNode<MyState>({
  approvedOutput: (s) => ({ output: `✅ 已通过：\n${s.draft}` }),   // 通过 → 确定性输出（不调 LLM）
  rejectedLlm: {                                                  // 否则 → LLM 按意见修订（复用 createLlmNode 选项）
    model: () => requireModel(appConfig, "review"),
    prompt: (s) => [new SystemMessage("按意见改写"), new HumanMessage(`原稿:${s.draft}\n意见:${s.feedback}`)],
    write: (r) => ({ output: `✏️ ${r.content}` }),
    config: appConfig, timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs,
  },
  // feedbackField?: "feedback"; isApproved?: 默认 isApproval
});
```

- 与 createHumanApprovalNode 互补:后者**前置** interrupt 收 feedback;本 factory **后置**——feedback 已在 state,按是否通过短路(不调 LLM)或调 LLM 修订。完整 HITL 流常是 `approval(前置) → … → finalize(后置)`。
- 例:[human-in-loop/travel/pm finalize](../src/libs/topologies/human-in-loop/graph.ts)。

## createPrepareNode —— input → 首条消息

```ts
const prepare = createPrepareNode<MyState>();  // 默认:state.input → HumanMessage → { messages }
// 或:new SystemMessage(systemPrompt) 前置
// createPrepareNode({ systemPrompt: "你是..." })
```

- 例:**默认图** prepare。

## createFanout —— Send map-reduce 扇出

```ts
const fanout = createFanout<Aspect, MyState>({
  items: (s) => ASPECTS,             // 待扇出的 item 列表
  target: "research",                // 所有并行实例进这个节点
  input: (aspect, s) => ({ currentAspect: aspect, destination: s.destination }),  // 每实例的 state 切片
});
graph.addConditionalEdges("gather", fanout, ["research"]);
// state 的聚合 channel 必须用 reducer(并行写才安全):results: Annotation<T[]>({ reducer: (a,b)=>[...a,...b] })
```

- 例:[travel-planner](../examples/travel-planner/) fanoutToResearch、[deep-research](../examples/deep-research/) fanoutToResearch。

## createSubgraphNode —— 子图作节点

```ts
const researcher = createSubgraphNode<ResearcherState>({
  state: ResearcherState,            // Annotation.Root spec
  nodes: { research: async (s) => ({ messages: [ai] }) },
  edges: [[START, "research"], ["research", END]],
});
parentGraph.addNode("research", researcher);   // 编译后的子图直接当节点
```

- 子图独立 state,经共享 channel(如 `messages`)与父图映射。
- 例:[dev-agent](../examples/dev-agent/) createResearcherSubgraph。

---

## 原语(bespoke 节点也可直接用)

| 原语 | 用途 |
|---|---|
| `extractText(content)` | LLM content(string 或 content block 数组)→ 纯文本 |
| `parseJson<T>(text)` | 从 LLM 文本抽第一段 JSON(容忍 ```json 围栏) |
| `emitStage(config, e)` / `emitPlan(config, entries)` / `emitTextToken(config, text)` | surface 事件生产端(writer + callback 双发) |
| `runTool(name, args, fn, onToolCall?)` | 执行一个工具 fn + 三态透出(自定义工具节点用) |
| `isApproval(feedback, opts?)` | HITL「通过」判定 |

---

## 路由(router)模式

- **HITL 门禁路由**(人审 → 通过/打回):`createHumanApprovalNode({ route })`(返回 Command)。
- **规则条件边**(`toolsCondition`、`routeAfterEvaluate` 等):就是普通 `(state) => nodeName` 纯函数,`addConditionalEdges` 连,可单测。
- **LLM 裁决路由**(反射/评估器),两种方式:
  - **节点内 Command goto**(推荐):`createLlmRouterNode`(上)——LLM 评审 → parse → 返回 Command goto。
  - **外部纯条件边**:`createLlmNode({ parse })` 写 decision + 配纯函数 `routeAfterXxx` + `addConditionalEdges`(见 project-manager `routeAfterEvaluate`)。routeAfterXxx 是 exported 纯函数,可被两种方式复用。

## 自定义 StructuredTool

在 `src/libs/tools/` 用 `tool()` + Zod 定义入参，在 `src/app/flow-tools.ts` 的 `createFlowTools()` → `buildTools()` 中注册；`think` 节点自动 `bindTools`。

- 字段名、类型、必填与工具契约（JSON Schema）对齐；返回值必须是 `string`。
- 需要运行时依赖时用工厂函数（参照 `platform-api.tool.ts`、`agent-variable.tool.ts`）。
- 参照 [docs/capabilities.md](capabilities.md) 的工具优先级：MCP → 内置 → 自写。

---

## 节点级 scaffold(custom 拓扑)

不想套预设拓扑、要按 nodes+edges+state 自由编排时,用 `custom` 拓扑(spec 即契约):
spec 声明 `state`(channels + reducer 类型)/ `nodes`(name→type+params)/ `edges`(static/conditional/fanout)/ `input`/`result`,
`scripts/scaffold/blueprints/custom.mjs` **生成时渲染**真实 `src/app/flows/<name>/graph.ts`(内联本目录 factory,受 tsc 检查;无运行时解释器)。节点 `type` 词表 + 选型见 [node-catalog.md](node-catalog.md);示例见 `scripts/scaffold/specs/_example.*.flow.json`(translate-review / grade-redo / router-gate / multi-aspect-search 等)。

进阶模式(Send/interrupt/Command/subgraph/checkpointer 的原生细节)见 [flow-patterns.md](flow-patterns.md)。
