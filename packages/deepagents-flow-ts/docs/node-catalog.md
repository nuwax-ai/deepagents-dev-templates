# node-catalog —— 节点类型目录(选型入口)

> **建 flow 先看这里**:有哪些节点类型、何时选哪个、在节点级 scaffold 的 spec 里叫什么 `type`。
> 各 factory 的**完整 API / 用法**见 [node-kit.md](node-kit.md)(本文件是选型 + 分类,不重复 API 细节)。
>
> 心智模型:「与做工作流一样」——先有**节点库**(本目录),再编排成图。8 个拓扑预设是节点组合的范例;
> 节点级 `custom` topology(见 [scaffold](../scripts/scaffold/))让你直接用本目录的 type 编排任意图。

## 三层分类

| 层 | 是什么 | 能否 `addNode` | 节点级 DSL `type` |
|---|---|---|---|
| **① FACTORY 节点** | 框架封装的参数化节点,`addNode("x", createYyy({...}))` | ✅ | ✅ 有 type 名 |
| **② BESPOKE 模式** | 无 factory,但有命名惯例 + 支撑原语;手写 | ✅(手写) | ⚠️ DSL 不支持,生成后手改 |
| **③ 支撑原语** | 节点**体内**调用的纯函数/工具(不是节点本身) | —(节点内用) | — |

---

## ① FACTORY 节点(11 种 type)

### LLM 类

| `type` | factory | 语义 | 何时用 |
|---|---|---|---|
| `llm` | `createLlmNode` | 一次调 LLM,写回文本或结构化(`parse`) | compose / aggregate / plan / rewrite;大多数 LLM 步骤 |
| `llm-stream` | `createLlmStreamNode` | **流式**调 LLM,逐 token 给用户 | draft / respond(用户可见大段输出) |
| `llm-router` 🆕 | `createLlmRouterNode` | LLM 裁决后**返回 Command goto**(节点内路由) | reflection / evaluator:评审 → 重做或放行 |

### HITL(人审)类

| `type` | factory | 语义 | 何时用 |
|---|---|---|---|
| `approval` | `createHumanApprovalNode` | **前置**审批:`interrupt` 暂停 → 收 feedback(通过/打回) | review / approve / confirm / clarify(把结果抛给人) |
| `approval-finalize` 🆕 | `createApprovalFinalizeNode` | **后置**定稿:按已收 feedback 短路(通过→确定性输出)/ 修订(否则 LLM 改) | HITL 流的最后一公里(finalize 节点) |

> `approval`(前置收 feedback)与 `approval-finalize`(后置按 feedback 定稿)**互补**,常配对:approval → … → finalize。

### 工具/检索类

| `type` | factory | 语义 | 何时用 |
|---|---|---|---|
| `tool-exec` | `createToolExecNode` | 执行模型 `tool_calls`(ReAct 工具步)+ 三态透出 | 默认图 tools 节点 |
| `mcp-retrieval` 🆕 | `createMcpRetrievalNode` | 调真实 MCP 检索(stdio,rateLimited + 三态) | RAG retrieve / travel research(接外部知识源) |

### 结构类

| `type` | factory | 语义 | 何时用 |
|---|---|---|---|
| `prepare` | `createPrepareNode` | input → 首条 HumanMessage(可拼系统提示) | 图入口归一化用户输入 |
| `fanout` | `createFanout` | **Send map-reduce 扇出**(返回条件边函数,非节点) | 并行调研聚合(travel/deep-research research) |
| `subgraph` | `createSubgraphNode` | 把一张小图编译后当节点用 | 子任务封装(dev-agent researcher) |
| `passthrough` | —(DSL 占位) | `(s) => ({})` 或固定写回 | 占位 / 调试 / 确定性变换(无需 factory 的纯数据节点) |

🆕 = 本批新增 factory（均已落地 + 进节点级 DSL enum）。

---

## ② BESPOKE 模式(无 factory,手写;节点级 DSL 不支持)

| 模式 | 代表 | 为何 bespoke | 出路 |
|---|---|---|---|
| **bindTools 的 ReAct think** | 默认图 think | think↔tools 循环里 think 既决策又写 AIMessage,与 ToolNode 耦合 | 用 `react-tools` 拓扑预设,不手写 |
| **文件交付** | deep-research delivery | interrupt 收路径 + 文件系统写 markdown/html | 手写;生成后改 |
| **多源检索取优** | deep-research research 子图 | Context7 ∥ DDG 双源 + 启发式评分合并 | 手写 subgraph(mcp-retrieval 仅单源/简单多源) |
| **自定义 reducer** | deep-research findings 去重 merge | 业务特定聚合逻辑 | DSL 用 `string-array-append` 近似,生成后改 reducer |
| **跨子图非平凡映射** | subgraph 与父图字段映射 | 共享 channel 映射 bespoke | 手写 |
| **含 emitPlan/emitStage 副作用** | deep-research planNode | 节点内发结构化事件需访问 config | B.4 已增强（createLlmNode/Stream write 收 config）;用 createLlmNode 在 write 内 emit |
| **逐项 LLM 评分 + 无凭证退回非破坏默认** | adaptive-rag grade_documents / grade_generation | 逐文档 / 逐生成 LLM 判 yes/no；无凭证 try/catch 退回放行（增强环节不阻塞主流程） | 手写；route_question / transform_query 用 `createLlmNode({ parse })` 即可 |
| **调原生工具（非 model tool_calls）** | adaptive-rag web_search | 直接 `webSearchTool.invoke()`（DuckDuckGo IA / Tavily） | 手写；非 ToolNode 模式 |

> 「图是契约」:bespoke 节点保留手写是设计选择(见各 example「保留 bespoke」注释),不是遗漏。

---

## ③ 支撑原语(节点体内调用)

| 原语 | 用途 |
|---|---|
| `requireModel(appConfig, label)` | 「无 demo fallback」模型凭证(真实接入用) |
| `extractText(content)` | LLM content → 纯文本 |
| `parseJson<T>(text)` | LLM 文本 → JSON(容忍 ```json 围栏) |
| `streamLLMText(...)` | 韧性流式调用(factory 内用,bespoke 也可) |
| `emitStage` / `emitPlan` / `emitTextToken` | surface 事件生产(writer + callback 双发) |
| `runTool(name, args, fn, onToolCall?)` | 执行一个工具 + 三态透出 |
| `isApproval(feedback, opts?)` | HITL「通过」判定 |
| `callResolvedMcpTool` / `rateLimited` / `McpServerConfig` | stdio MCP 客户端(见 `src/libs/mcp/stdio-client.ts`) |

> 原语是节点的「建材」,不是节点本身——不要 `addNode("x", emitPlan)`。

---

## 选型决策树(4 问)

```
Q1 节点要暂停等人吗?(interrupt)
  是 → HITL 类
       ├ 暂停在前(把结果抛给人审)        → approval (createHumanApprovalNode)
       └ 这是定稿(按已收 feedback 决定输出) → approval-finalize (createApprovalFinalizeNode) 🆕
  否 → Q2

Q2 节点要调 LLM 吗?
  是 → Q2a 裁决后要节点内路由(reflection/evaluator)?
        是 → llm-router (createLlmRouterNode) 🆕
        否 → Q2b 用户可见大段输出 + 模型支持 stream?
                是 → llm-stream (createLlmStreamNode)
                否 → llm (createLlmNode,+ parse 做结构化)
  否 → Q3

Q3 节点要检索外部知识(MCP)吗?
  是 → mcp-retrieval (createMcpRetrievalNode) 🆕
  否 → Q4

Q4 结构类?
  input → 首条 HumanMessage       → prepare (createPrepareNode)
  并行扇出 map-reduce              → fanout (createFanout,⚠️ 边函数非节点)
  一张小图当节点                   → subgraph (createSubgraphNode)
  执行 tool_calls                  → tool-exec (createToolExecNode)
  纯数据变换 / 占位                 → passthrough
  都不是                           → bespoke(保留手写,见②)
```

---

## type 词表(节点级 DSL `node.type` 单一权威)

**custom DSL 支持的 7 个 node.type**(`scripts/scaffold/schema.mjs` 的 `custom` enum,`tests/node-catalog.test.ts` 断言一致):

```
llm | llm-router | approval | approval-finalize | mcp-retrieval | prepare | passthrough
```

**factory 类型但暂未进 custom DSL**(手写图直接用 factory;custom 里生成后手改):`llm-stream`(createLlmStreamNode)、`tool-exec`(createToolExecNode,需 tools)、`subgraph`(createSubgraphNode)。
注:`fanout` 在 DSL 里是 **edge kind**(`{kind:"fanout"}`),非 node.type。

---

## edge 约束(custom DSL)

- **conditional 边**:`condition` 的返回值必须 ∈ 其 `targets`,否则运行时 LangGraph 抛 `Invalid edge`。静态反射(`pnpm graph` / COMPLETION_GATE)**不执行 condition,检不出该错配**——需人工核对(`generate` 时也会打印提醒)。
- **llm-router 节点**:其 `route` 的 `goto` 目标须在 spec 的 `params.ends` 内声明,否则反射会丢掉这些 Command 路由边(如 `gate→draft` 重做边)。

---

## 关系

- **[node-kit.md](node-kit.md)**:各 factory 的完整 API + 用法 snippet(本文件只管选型/分类)。
- **[flow-patterns.md](flow-patterns.md)**:Send/interrupt/Command/subgraph/checkpointer 的原生细节。
- **节点级 scaffold**：`custom` topology 的 spec 用本目录的 `type` 编排 nodes+edges+state → 生成图(见 [scripts/scaffold/](../scripts/scaffold/))。
