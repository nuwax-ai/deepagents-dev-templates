# deepagents-flow-ts

**通用工作流编排模板** —— Agent 按「设计好的节点连线规则（node + edge）」作为 LangGraph 工作流运行，而不是自由的 tool loop。

> **两种获取方式**：
> - **源码开发**（git / npm 源码包，含 `src/`、`examples/`、`tsconfig`）：本目录 `pnpm install && pnpm build` 即可改默认图、跑示例、扩展能力。
> - **Nuwax 运行时制品**（平台分发的 `.tar.gz` / `.zip`）：自包含 `dist/bundle.mjs`，由平台直接运行，**无需 `build`**；不含 `src/`，随包的 `examples/` 仅作**只读参考源码**（其 `import "../../src"` 在制品内不解析，需完整源码仓库才能运行）。
>
> 底层配置/模型/MCP 由模板**自包含**提供（[src/runtime/](src/runtime/)，无外部 runtime 依赖；MCP 用 `@langchain/mcp-adapters`）。

本模板是 **工作流编排 Agent**（显式 LangGraph 图），与 Coding Agent（tool loop）产品形态不同；运行时基础能力由模板**自包含的底层运行时**（`src/runtime/`）承担，「大脑」是一张可设计的节点图。

> **本文档**介绍本仓库（`deepagents-flow-ts` 工作目录）的项目结构、分层规则、命令与检查清单；API 细节见源码与 `docs/`。

## 快速开始

```bash
pnpm install && pnpm build
pnpm flow "你好"          # 跑默认 ReAct flow（CLI；无凭证走 fallback 也能跑）
pnpm start:acp           # 或启动 ACP 服务（供 Zed/JetBrains）
```

**拼你自己的 flow** = 组合 `src/libs/nodes/` 的节点 factory + 在 `src/app/graph.ts` 连线：

```ts
import { createLlmNode, createHumanApprovalNode } from "./libs/nodes/index.js";

const gen = createLlmNode<S>({ model: () => model, prompt: (s) => [/* msgs */], write: (r) => ({ draft: r.content }) });
const review = createHumanApprovalNode<S>({ question: (s) => `草稿:${s.draft},ok?`, write: (fb) => ({ feedback: fb }) });

const graph = new StateGraph(S)
  .addNode("gen", gen).addNode("review", review)
  .addEdge(START, "gen").addEdge("gen", "review").addEdge("review", END)
  .compile({ checkpointer });
```

- **节点选型**见 [docs/node-catalog.md](docs/node-catalog.md)；**factory API** 见 [docs/node-kit.md](docs/node-kit.md)
- **一句话需求 → flow**：`scripts/scaffold/`（9 拓扑：8 预设 = react-tools / human-in-loop / project-manager / travel-planner / rag / adaptive-rag / deep-research / dev-agent + `custom` 任意节点级编排）
- 进阶模式（Send / interrupt / subgraph / 长任务硬化）见 [docs/flow-patterns.md](docs/flow-patterns.md)
- 6 个完整可跑范例见 [examples/](examples/)

## 项目结构 + 分层

```
src/
  core/          纯类型契约（各层共享）
  runtime/       底层运行时（config/model/logger/mcp/checkpoint/llm-resilience + flow-config/flow-runtime）
  libs/          ★ 可复用构建件（保护、消费不改）
    nodes/         节点 factory + 原语（建 flow 用，见 node-kit.md）+ model-resolver（凭证策略）
    tools/         内置通用工具（bash/fs/search/demo/http/json/skill；MCP 工具由 runtime 经 @langchain/mcp-adapters 原生注入，非 toolkit 静态导出）
    topologies/    拓扑积木（adaptive-rag/rag/deep-research/human-in-loop/project-manager/travel-planner；图逻辑单一权威 graph/topology/recipe；scaffold 生成薄封装复用；单向依赖 nodes/+mcp/；react-tools 复用默认图、dev-agent 在 app/topologies/）
    mcp/           stdio MCP 客户端（callResolvedMcpTool/rateLimited；零 src import，自包含）
    deepagents-acp/  vendored ACP SDK（自包含）
  app/           默认 ReAct 图（★ 可改、开发工作区）：graph.ts + nodes/ + flow-tools/task + state/topology/default-flow + flows/（注册表+scaffold 薄封装）+ topologies/（app 层拓扑，如 dev-agent stateful-custom）
  surfaces/      ACP/CLI 适配器（保护）：acp/ cli/ + stateful-flow/map-stream-chunk/...
  index.ts       入口 + 组合根（createFlowRuntime + materializeFlow 桥接 stateful-recipe）
examples/        参考实现（只读；dedup 后 graph/nodes 多为 re-export shim 指向 libs/topologies）
config/ prompts/ skills/ scripts/ docs/ tests/
```

分层（只能 import 左侧）：**`core → runtime → libs → app → surfaces → index.ts`**（`libs` 内 nodes/tools/deepagents-acp/mcp 互不引用；`topologies/` 单向依赖 nodes/+mcp/，其余子目录不反向引 topologies/）。`tests/layering.test.ts` 强制（layerOf 粒度到 libs top-level），**零例外**。

## 建 flow

**重用单位 = `src/libs/nodes/` 节点 factory**（泛型于 State + `prompt(state)`/`write(result,state)` 回调），不是手写节点体。详见 **[docs/node-kit.md](docs/node-kit.md)**：

`createLlmNode` · `createLlmStreamNode` · `createLlmRouterNode`（LLM 裁决 → Command goto）· `createToolExecNode` · `createHumanApprovalNode`（HITL 前置 interrupt）· `createApprovalFinalizeNode`（HITL 后置定稿）· `createMcpRetrievalNode`（主动 MCP 检索）· `createPrepareNode` · `createFanout` · `createSubgraphNode`

> bespoke 节点**不强塞** factory（多源检索取优、文件交付、converse 路由等）——保留手写，见各 example 注释与 [node-catalog.md](docs/node-catalog.md) ② BESPOKE。

两种方式落地：

1. **脚手架优先**（一句话 / 简单场景）：写 spec → `node scripts/scaffold/generate.mjs <spec>` → 改 `config/flow-agent.config.json` 的 `activeFlow`（自带 typecheck+graph 自验）
2. **直接改默认图**：编辑 [src/app/graph.ts](src/app/graph.ts) 连线 + [src/app/nodes/](src/app/nodes/) 节点逻辑；或对照 [examples/](examples/) 在 `src/app/` 实现

**多 flow 选图**：`config/flow-agent.config.json` 顶层 `activeFlow`（缺省 `default`）经 [src/app/flows/index.ts](src/app/flows/index.ts) 注册表解析——`flow` / `graph` / ACP 三条入口共用。已注册：`default`（conversational ReAct）、`knowledge-qa` / `adaptive-knowledge-qa` / `customer-support`（conversational）、`trip-planner` / `project-planner` / `content-review` / `research-agent` 等 scaffold 场景 flow，及 `coding-agent`（stateful-custom）。`pnpm graph` 导出**当前 activeFlow** 的拓扑。

**两类 flow**（[src/core/flow-types.ts](src/core/flow-types.ts)）：
- `FlowExecutor`：one-shot，`(query, cb) => Promise<FlowResult>`。无记忆单次调用（见 examples/rag）。
- `StatefulFlow`：支持 human-in-the-loop，`run({query|resume}, threadId, cb) => {done|interrupted}`。图里 `interrupt` 暂停 → surface 把问题发给用户 → 下一轮 `resume`。**别手写 run-loop**——用 `createStatefulFlow`（[src/surfaces/stateful-flow.ts](src/surfaces/stateful-flow.ts)），它有**两种用法**：
  - **HITL 长任务**（默认）：暴露 `hasStarted`，首条 query 开题、之后续跑同一任务（`resume` 走 interrupt 续跑）。
  - **conversational 对话**（`conversational: true`，如 default / knowledge-qa / adaptive-knowledge-qa / customer-support）：不暴露 `hasStarted`，surface 每轮走 query + 稳定 threadId + checkpointer → 多轮记忆；图层 `graph.stream` 真流式。详见 [docs/flow-patterns.md](docs/flow-patterns.md) 第 6 节。

## 开发规则

- **图是契约** — 连线/条件路由在 `graph.ts`；节点优先 factory、bespoke 才手写到 `nodes/`；决策逻辑抽纯函数 + 单测。
- **先 factory 后手写** — 节点先查 [node-kit.md](docs/node-kit.md)；bespoke 保留并注释「为何不用 factory」。
- **保护区** — `core`/`runtime`/`libs`/`surfaces` 默认不改；`src/app/` 可改；`examples/` 只读。
- **有状态用基座** — `createStatefulFlow`，不手写 run-loop。
- **工具顺序** — native MCP（`config/mcp.default.json` + ACP session 合并）→ `libs/tools` 内置（bash/fs/search/http/json）→ 自写代码。
- **密钥** — 环境变量，禁止硬编码。
- **依赖只在本仓库** — 缺能力 `pnpm install` / 在 `src/runtime/` 扩展 / copy-in，不引仓库外路径。

## 默认图（标准 LangGraph ReAct）

开箱即用的默认图是标准 ReAct，经 **StatefulFlow conversational** 运行（稳定 threadId + checkpointer 多轮记忆 + `graph.stream` 真流式；见 [src/app/default-flow.ts](src/app/default-flow.ts)）。工具/持久化全用框架原生能力：

```
START → prepare → think(model.bindTools) ──(toolsCondition)──┐
                      ▲                                      ├─ 有 tool_calls → tools(ToolNode + onToolCall 透出) → think
                      └──────────────────────────────────────┘
                                               └─ 无 tool_calls → respond(流式) → END
```

| 节点 | 职责 | 框架能力 |
|---|---|---|
| `prepare` | input → HumanMessage；压缩接入点 | `MessagesAnnotation` |
| `think` | `bindTools` 模型决定调工具或回答 | 原生 function-calling |
| `tools` | 执行 tool_calls + `onToolCall` 三态透出 | prebuilt `ToolNode` + `toolsCondition` |
| `respond` | 取回答流式输出（onToken） | — |

状态用标准消息流（`MessagesAnnotation`），自动进 `FileCheckpointSaver`（跨重启恢复 + interrupt/resume）。
工具集来自 `FlowRuntime.allTools`（[src/app/flow-tools.ts](src/app/flow-tools.ts)）：bash / 文件读写 / grep·glob / http / json + **native MCP**（context7 等，经 `@langchain/mcp-adapters` 加载；`config/mcp.default.json` + ACP session `mcpServers` 合并）+ demo(echo/calculate/time) + 可选 `load_skill` / `task`（子智能体 subagent 委派，流式透出 token 与 `[subagent] tool` 调用）。
无模型凭证时 think 走 fallback（回显输入），图始终可跑、可测。见 [src/app/graph.ts](src/app/graph.ts)。

**进阶模式**（并行 fan-out、HITL `interrupt`、subgraph 子智能体（subagent）、压缩、**长任务硬化**：跨重启续跑 / 阶段进度 / 单步护栏）见 [docs/flow-patterns.md](docs/flow-patterns.md)；
能力分层与配置见 [docs/capabilities.md](docs/capabilities.md)。

## 示例：不同需求 → 不同拓扑

| 示例 | 需求类型 | 拓扑 | LangGraph 特性 | seam |
|---|---|---|---|---|
| [examples/rag](examples/rag/) | 检索增强问答 | 线性 + 条件重试 | `addConditionalEdges` 重试 | one-shot |
| [examples/travel-planner](examples/travel-planner/) | 并行调研聚合 | 并行 map-reduce + HITL | `Send` 扇出 + reducer + 真实搜索 MCP | stateful |
| [examples/project-manager](examples/project-manager/) | 分解-评估-审批 | 评估循环 + HITL | reflection 回边 + 条件边 | stateful |
| [examples/human-in-loop](examples/human-in-loop/) | 生成→人审→定稿 | 线性 + 中途暂停 | `interrupt` + `Command(resume)` | stateful |
| [examples/dev-agent](examples/dev-agent/) | 综合能力展示 | 标准 ReAct + subgraph | bindTools/ToolNode/FileCheckpointSaver/compactHistory/subgraph | stateful |
| [examples/deep-research](examples/deep-research/) | 深度研究报告（长任务） | 多阶段流水线 + 双层 reflection + 持续会话 | 2 确认门 + Send 并行调研 + 条件边循环 + 报告后持续会话 + 跨重启续跑/阶段进度/护栏 | stateful |

每个示例都**不重写** surface plumbing：写自己的图 + 节点 → 包成 `FlowExecutor`/`StatefulFlow` → 插进同一套 `bootstrapFlowAcp`/`runFlowCli`。有状态示例共用 **`createStatefulFlow`** 基座 —— 统一 interrupt/resume run-loop + 默认 `FileCheckpointSaver` 持久化 + 从 checkpointer 推断续跑（`hasStarted`：一个会话一个主题，首条开题、之后续跑同一项目），**长任务跨进程/IDE 重启可续跑**。

示例**真实接入**业务依赖（travel 用可配置搜索 MCP；其余 LLM 节点真调大模型），**无 demo fallback——未配凭证直接报错**；运行前在 `.env` 配模型凭证（见下）。各示例的图拓扑 / 路由仍抽成纯函数单测，无凭证恒跑；真实接入用例 `skipIf` 无凭证自动跳过。

> 这与**默认 flow**（`src/app`，内置 demo 工具 + 无凭证启发式 fallback、始终可跑）取向不同：默认 flow 重「开箱即跑」，示例重「贴近真实业务」。**不要改 examples/，在 `src/app/` 实现。**

**关键 seam**：surface 与具体图解耦。[src/surfaces/acp/server.ts](src/surfaces/acp/server.ts) 的 `bootstrapFlowAcp` 和 [src/surfaces/cli/run.ts](src/surfaces/cli/run.ts) 的 `runFlowCli` 按 `typeof executor` 自动分流两类 flow。ACP 路径用 deepagents-acp 的 `onPrompt` 钩子跑 executor、经 `conn` 流式回传、返回 `{ stopReason }` **短路 deep agent**。

## 运行

在项目根目录（本 `package.json` 所在目录）：

```bash
pnpm install && pnpm build

# 默认 flow：CLI（尊重 config.activeFlow）
pnpm flow "随便说点什么"
pnpm exec tsx src/index.ts flow -i

# 默认 flow：ACP 服务（供 Zed / JetBrains 等 ACP host）
pnpm start:acp

# 导出图拓扑 / 能力查询 / 会话
pnpm graph                              # 当前 activeFlow 拓扑 JSON；加 --mermaid 输出 Mermaid
pnpm exec tsx src/index.ts capabilities # 无凭证，工具/MCP/skills/subagents
pnpm exec tsx src/index.ts sessions     # 已持久化会话
pnpm exec tsx src/index.ts sessions delete <thread-id>

# 可选：--config <path> 指定配置文件（默认 config/flow-agent.config.json）

# 跑范例（travel/pm/review 会在中途暂停等你输入确认/审阅）
pnpm example rag "什么是 LangGraph？"
pnpm example travel "东京 3 天 美食优先"
pnpm example pm "做一个落地页"
pnpm example review "写一段产品介绍"
pnpm example dev-agent
pnpm example research "调研 LangGraph 生态"

# 验证
pnpm test && pnpm typecheck && pnpm typecheck:examples
pnpm smoke                          # 默认 flow ACP 冒烟（-- --dry-run 仅打印）
pnpm smoke -- --example rag         # 指定范例冒烟
```

模型凭证见 [`.env.example`](.env.example)（ACP 模式下通常由 IDE host 注入）。

## 调试

| 目标 | 命令 |
|---|---|
| 默认 flow CLI | `pnpm flow "..."` / `pnpm exec tsx src/index.ts flow -i` |
| 导出图拓扑 | `pnpm graph`（JSON）/ `pnpm graph --mermaid`（Mermaid 源） |
| 能力分层查询 | `pnpm exec tsx src/index.ts capabilities`（无凭证，工具/MCP/skills/subagents） |
| 已持久化会话 | `pnpm exec tsx src/index.ts sessions` / `sessions delete <id>` |
| 默认 flow ACP 冒烟（rcoder） | `pnpm smoke` |
| 范例 CLI | `pnpm example rag "..."` / `pnpm example rag -i`（交互） |
| travel/pm/review 范例 CLI | `pnpm example travel "..."` / `example pm "..."` / `example review "..."`（中途暂停等输入；加 `-i` 交互） |
| dev-agent / deep-research 范例 | `pnpm example dev-agent` / `pnpm example research "..."` |
| 范例 ACP 冒烟（rcoder） | `pnpm smoke -- --example rag` / `--example dev-agent` |
| 类型检查 | `pnpm typecheck`（src）/ `pnpm typecheck:examples`（examples + src，noEmit） |

`pnpm smoke` 用 rcoder-cli 端到端驱动 ACP（握手 → `onPrompt` → 整图 → 流式答案）；`--entry PATH` 或 `--example NAME` 或 `AGENT_ENTRY` 可指向任意 flow 入口。`pnpm example --list` 列出全部范例。
**在 Zed 里 chat 调试**全部入口的 `agent_servers` 配置 + HITL 两轮玩法见 [docs/zed-debug.md](docs/zed-debug.md)。

## 导出图拓扑（可视化对接）

显式 StateGraph 的好处之一：节点连线是**静态可提取**的。`./topology` 把编译图反射成结构化数据（不运行图、不需要凭证），供 inspector / 文档 / 调试器消费：

```bash
pnpm graph              # → 当前 activeFlow 的 { nodes, edges } JSON
pnpm graph --mermaid    # → Mermaid 源，可直接渲染
```

```ts
import { getFlowTopology } from "deepagents-flow-ts/topology";
const { nodes, edges, mermaid } = await getFlowTopology();
```

`edges[].conditional` 标出条件边（如 `reflect → think|respond`），数据来自 `getGraphAsync()`，与 [src/app/graph.ts](src/app/graph.ts) 的真实连线**永不漂移**。导出逻辑见 [src/app/topology.ts](src/app/topology.ts)。

## 配置与能力分层

[config/flow-agent.config.json](config/flow-agent.config.json)：标准 `agent` / `model` / `mcp` / `permissions` / `sandbox` / `skills` / `agentsDirectories` / `memory` / `compaction` / `middleware` 段，以及顶层 **`activeFlow`**（选 [src/app/flows/](src/app/flows/) 注册表中的 flow；缺省 `default`）。配置走 `loadFlowConfig` → 底层 `loadConfig`（[src/runtime/](src/runtime/)），Zod schema 校验。自定义块加在顶层、用 `loadFlowConfig().raw` 取出（RAG 范例放 `rag` 段）。

**能力分层**（工作区配置 / 内置 / 环境 / 文件持久化）见 [docs/capabilities.md](docs/capabilities.md) 与 [.nuwax-agent/capability-sources.json](.nuwax-agent/capability-sources.json)——`capabilities` 命令查询当前可用工具/MCP/skills/子智能体（subagents）。

**版本同步**：以 `package.json` 的 `version` 为权威源；`pnpm version:sync` 同步 `agent.version` 与 `.nuwax-agent/agent-package.json` 发布元数据（`pnpm package` 前置 `version:check`）。

默认模型 `openai / deepseek-chat`（见 [config/flow-agent.config.json](config/flow-agent.config.json)，已对齐国内 OpenAI 兼容端点；切回 Anthropic 把 `model.provider` 设为 `anthropic`）。各端点配置见 [`.env.example`](.env.example)。

> 升级提示：会话/checkpoint 默认目录已从项目内 `./.flow-sessions` 调整为用户目录 `~/.flowagents/<workspace 散列>/`。如果需要继续读取旧会话，把 `config.memory.dir` 显式设回 `./.flow-sessions`；新项目建议保留默认值，避免会话文件混进源码包。

## 测试

```bash
pnpm test
```

- `tests/` — 默认图（条件边决策表 + 收敛）、纯函数（safeCalc 注入边界等）、图拓扑导出、分层守卫（`layering.test.ts`）
- `examples/*/tests/` — 范例：RAG 重试、travel 并行+HITL、pm 评估循环+HITL、review 人审闭环

## 提交前检查

- [ ] 无硬编码密钥 · 无 `any` · import 带 `.js` 后缀
- [ ] 节点名不与 state channel 同名 · 决策函数（条件边路由）有单测
- [ ] 分层合规（`layering.test.ts` 绿）· runtime 自包含（无仓库外路径）

## 扩展阅读

本仓库 `docs/` **只描述模板工作目录内的能力、配置与图规则**；在云开发环境中，开发 Agent 的脚手架流程、平台登记与完成闸门由**独立注入的技能包**引导（与模板源码分离，不随模板分发）。

- [docs/flow-orchestration.md](docs/flow-orchestration.md) — **编排速查**（框架优先 / 核心编排模式 / 命名坑 / 能力来源）
- [docs/node-catalog.md](docs/node-catalog.md) — **节点选型入口**（type 目录 + 何时用哪个）
- [docs/flow-graph-rules.md](docs/flow-graph-rules.md) — **图编排规则**（R-G001+，可持续追加）
- [docs/node-kit.md](docs/node-kit.md) — **factory catalog（建 flow 必读）**
- [docs/troubleshooting.md](docs/troubleshooting.md) — **排错索引**（`LLM 未返回 JSON` / Invalid edge / HITL / spec 漂移）
- [docs/flow-patterns.md](docs/flow-patterns.md) — 进阶模式（Send/interrupt/Command/subgraph/checkpointer/长任务硬化）
- [docs/zed-debug.md](docs/zed-debug.md) · 各 `examples/*/README.md`
- **API 细节看源码**：`FlowRuntime`（[src/runtime/flow-runtime.ts](src/runtime/flow-runtime.ts)）、`FlowCallbacks`（[src/core/flow-types.ts](src/core/flow-types.ts)）、`createFlowRuntime`（[src/index.ts](src/index.ts)）、Surface Seam（[src/surfaces/](src/surfaces/)）、ACP hooks（[src/libs/deepagents-acp/](src/libs/deepagents-acp/)）、`createFlowTools`（[src/app/flow-tools.ts](src/app/flow-tools.ts)）
