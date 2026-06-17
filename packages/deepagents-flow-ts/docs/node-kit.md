# node-kit —— 节点 factory catalog

> **建 flow 必读**。`src/libs/nodes/` 把 LangGraph 常见节点模式做成**参数化节点 factory**——
> 你拼图时优先 `addNode("x", createYyyNode({...}))`,不再每个节点手写 `async (state) => ...` 体。
> factory 泛型于 State(`S`),用 `prompt(state)`/`write(result, state)` 回调解耦具体 state 形状。

```ts
import {
  createLlmNode, createLlmStreamNode, createToolExecNode,
  createHumanApprovalNode, createPrepareNode, createFanout, createSubgraphNode,
  // 原语(bespoke 节点也可用)
  extractText, parseJson, emitStage, emitPlan, emitTextToken, runTool, isApproval, streamLLMText,
} from "../libs/nodes/index.js";
```

## 何时用哪个

| 场景 | factory | 例 |
|---|---|---|
| 一次调 LLM,写回文本 | `createLlmNode` | compose/aggregate/finalize |
| 一次调 LLM,写回**结构化** JSON | `createLlmNode({ parse })` | plan/evaluate/review/rewrite |
| **流式**调 LLM,逐 token 给用户 | `createLlmStreamNode` | draft/respond |
| 执行模型 `tool_calls`(ReAct 工具步) | `createToolExecNode` | 默认图 tools |
| 人审门:`interrupt` 暂停 → 通过/打回 | `createHumanApprovalNode` | review/approve/confirm/clarify |
| input → 首条 HumanMessage | `createPrepareNode` | 默认图 prepare |
| 并行扇出(Send map-reduce) | `createFanout` | travel/deep-research research |
| 把一张小图当节点用 | `createSubgraphNode` | dev-agent researcher |

> **bespoke 不要硬塞**:含 `isApproval` 短路(通过则不调 LLM)、自定义 MCP 检索、反射 Command-goto 路由、emitPlan 副作用需 config 的节点——保留手写,见各 example 的「保留 bespoke」注释。

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
- 例:[human-in-loop](../examples/human-in-loop/) compose、[travel-planner](../examples/travel-planner/) aggregate、[project-manager](../examples/project-manager/) plan/estimate/evaluate、[rag](../examples/rag/) rewrite。

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

## 路由(router)模式 —— 不单独 factory

LangGraph 原生已覆盖,无需封装:
- **HITL 门禁路由**:用 `createHumanApprovalNode({ route })`(上)。
- **规则条件边**(`toolsCondition`、`routeAfterEvaluate` 等):就是普通 `(state) => nodeName` 函数,直接写。
- **LLM 裁决路由**(反射/评估器):评估节点用 `createLlmNode({ parse })` 写 decision,配一个纯条件边函数 `(s) => redo|done`(见 project-manager `routeAfterEvaluate`)。无 `createEvaluatorNode`——它与 createLlmNode(parse) 重复,且 route 是 exported 纯函数无法被 factory 绑定。

进阶模式(Send/interrupt/Command/subgraph/checkpointer 的原生细节)见 [flow-patterns.md](flow-patterns.md)。
