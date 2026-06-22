# deepagents-flow-ts

**通用工作流编排模板** —— Agent 按「设计好的节点连线规则（node + edge）」作为 LangGraph 工作流运行，而不是自由的 tool loop。

> **两种获取方式**：
> - **源码开发**（git / npm 源码包，含 `src/`、`examples/`、`tsconfig`）：本目录 `pnpm install && pnpm build` 即可改默认图、跑示例、扩展能力。
> - **Nuwax 运行时制品**（平台分发的 `.tar.gz` / `.zip`）：自包含 `dist/bundle.mjs`，由平台直接运行，**无需 `build`**；不含 `src/`，随包的 `examples/` 仅作**只读参考源码**（其 `import "../../src"` 在制品内不解析，需完整源码仓库才能运行）。
>
> 底层配置/模型/MCP 由模板**自包含**提供（[src/runtime/](src/runtime/)，无外部 runtime 依赖；MCP 用 `@langchain/mcp-adapters`）。

本模板是 **工作流编排 Agent**（显式 LangGraph 图），与 Coding Agent（tool loop）产品形态不同；运行时基础能力由模板**自包含的底层运行时**（`src/runtime/`）承担，「大脑」是一张可设计的节点图。

> **本文档**同时服务人类开发者与在本仓库工作的 AI Agent：项目结构、分层规则、开发约束、命令与检查清单均在此；API 字段/接口/hook 细节见源码与 `docs/`（需要时再查）。

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
- **一句话需求 → flow**：`scripts/scaffold/`（8 拓扑：7 预设 + `custom` 任意节点级编排）
- 进阶模式（Send / interrupt / subgraph / 长任务硬化）见 [docs/flow-patterns.md](docs/flow-patterns.md)
- 6 个完整可跑范例见 [examples/](examples/)

## 项目结构 + 分层

```
src/
  core/          纯类型契约（各层共享）
  runtime/       底层运行时（config/model/logger/mcp/checkpoint/llm-resilience + flow-config/flow-runtime）
  libs/          ★ 可复用构建件（保护、消费不改）
    nodes/         节点 factory + 原语（建 flow 用，见 node-kit.md）+ model-resolver（凭证策略）
    tools/         内置通用工具（bash/fs/search/demo/mcp-bridge/http/json/skill）
    topologies/    7 拓扑积木（图逻辑单一权威：graph/topology/recipe；scaffold 生成薄封装复用；单向依赖 nodes/+mcp/）
    mcp/           stdio MCP 客户端（callResolvedMcpTool/rateLimited；零 src import，自包含）
    deepagents-acp/  vendored ACP SDK（自包含）
  app/           默认 ReAct 图（★ 可改、开发工作区）：graph.ts + nodes/ + flow-tools/task + state/topology/default-flow/compaction + flows/（注册表+scaffold 薄封装）+ topologies/（app 层拓扑，如 dev-agent stateful-custom）
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

1. **脚手架优先**（一句话 / 简单场景）：写 spec → `node scripts/scaffold/generate.mjs <spec>` → 改 `config` 的 `activeFlow`（自带 typecheck+graph 自验）
2. **直接改默认图**：编辑 [src/app/graph.ts](src/app/graph.ts) 连线 + [src/app/nodes/](src/app/nodes/) 节点逻辑；或对照 [examples/](examples/) 在 `src/app/` 实现

**两类 flow**（[src/core/flow-types.ts](src/core/flow-types.ts)）：
- `FlowExecutor`：one-shot，`(query, cb) => Promise<FlowResult>`。适合问答 / 检索 / 批处理（见 examples/rag）。
- `StatefulFlow`：支持 human-in-the-loop，`run({query|resume}, threadId, cb) => {done|interrupted}`。图里 `interrupt` 暂停 → surface 把问题发给用户 → 下一轮 `resume`。**别手写 run-loop**——用 `createStatefulFlow`（[src/surfaces/stateful-flow.ts](src/surfaces/stateful-flow.ts)）。

## 开发规则

- **图是契约** — 连线/条件路由在 `graph.ts`；节点优先 factory、bespoke 才手写到 `nodes/`；决策逻辑抽纯函数 + 单测。
- **先 factory 后手写** — 节点先查 [node-kit.md](docs/node-kit.md)；bespoke 保留并注释「为何不用 factory」。
- **保护区** — `core`/`runtime`/`libs`/`surfaces` 默认不改；`src/app/` 可改；`examples/` 只读。
- **有状态用基座** — `createStatefulFlow`，不手写 run-loop。
- **工具顺序** — MCP → `libs/tools` 内置（bash/fs/search/http/json/mcp-bridge）→ 自写代码。
- **密钥** — 环境变量，禁止硬编码。
- **依赖只在本仓库** — 缺能力 `pnpm install` / 在 `src/runtime/` 扩展 / copy-in，不引仓库外路径。

## 默认图（标准 LangGraph ReAct）

开箱即用的默认图是标准 ReAct，工具/持久化全用框架原生能力：

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
工具集来自 `FlowRuntime.allTools`：bash / 文件读写 / search / http / json / mcp-bridge + native MCP（context7 等，经 ACP 或 `mcp.default.json` 配置）+ demo(echo/calculate/time) + 可选 `load_skill` / `task`。
无模型凭证时 think 走 fallback（回显输入），图始终可跑、可测。见 [src/app/graph.ts](src/app/graph.ts)。

**进阶模式**（并行 fan-out、HITL `interrupt`、subgraph 子代理、压缩、**长任务硬化**：跨重启续跑 / 阶段进度 / 单步护栏）见 [docs/flow-patterns.md](docs/flow-patterns.md)；
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

# 默认 flow：CLI
pnpm flow "随便说点什么"
pnpm exec tsx src/index.ts flow -i

# 默认 flow：ACP 服务（供 nuwaclaw/Zed/JetBrains）
pnpm start:acp

# 导出图拓扑 / 能力查询 / 会话
pnpm graph                              # JSON；加 --mermaid 输出 Mermaid
pnpm exec tsx src/index.ts capabilities # 无凭证，工具/MCP/skills
pnpm exec tsx src/index.ts sessions     # 已持久化会话

# 跑范例（travel/pm/review 会在中途暂停等你输入确认/审阅）
pnpm example:rag:cli "什么是 LangGraph？"
pnpm example:travel "东京 3 天 美食优先"
pnpm example:pm "做一个落地页"
pnpm example:review "写一段产品介绍"

# 验证
pnpm test && pnpm typecheck && pnpm typecheck:examples
pnpm smoke:acp                          # ACP 冒烟（-- --dry-run 仅打印）
```

模型凭证见 [`.env.example`](.env.example)（ACP 模式下通常由 IDE host 注入）。

## 调试

| 目标 | 命令 |
|---|---|
| 默认 flow CLI | `pnpm flow "..."` / `pnpm exec tsx src/index.ts flow -i` |
| 导出图拓扑 | `pnpm graph`（JSON）/ `pnpm graph --mermaid`（Mermaid 源） |
| 能力分层查询 | `pnpm exec tsx src/index.ts capabilities`（无凭证，工具/MCP/skills） |
| 已持久化会话 | `pnpm exec tsx src/index.ts sessions` |
| 默认 flow ACP 冒烟（rcoder） | `pnpm smoke:acp` |
| RAG 范例 CLI | `pnpm example:rag:cli "..."` / `pnpm example:rag:interactive` |
| travel/pm/review 范例 CLI | `pnpm example:travel "..."` / `example:pm "..."` / `example:review "..."`（中途暂停等输入；加 `-i` 交互） |
| RAG 范例 ACP 冒烟（rcoder） | `pnpm smoke:rag` |
| 类型检查 | `pnpm typecheck`（src）/ `pnpm typecheck:examples`（examples + src，noEmit） |

`smoke:acp` / `smoke:rag` / `smoke:travel` / `smoke:pm` / `smoke:review` 用 rcoder-cli 端到端驱动 ACP（握手 → `onPrompt` → 整图 → 流式答案）；`scripts/smoke-acp.mjs` 的 `--entry` 或 `AGENT_ENTRY` 可指向任意 flow 入口。
**在 Zed 里 chat 调试**全部入口的 `agent_servers` 配置 + HITL 两轮玩法见 [docs/zed-debug.md](docs/zed-debug.md)。

## 导出图拓扑（可视化对接）

显式 StateGraph 的好处之一：节点连线是**静态可提取**的。`./topology` 把编译图反射成结构化数据（不运行图、不需要凭证），供 inspector / 文档 / 调试器消费：

```bash
pnpm graph              # → { nodes, edges } JSON
pnpm graph --mermaid    # → Mermaid 源，可直接渲染
```

```ts
import { getFlowTopology } from "deepagents-flow-ts/topology";
const { nodes, edges, mermaid } = await getFlowTopology();
```

`edges[].conditional` 标出条件边（如 `reflect → think|respond`），数据来自 `getGraphAsync()`，与 [src/app/graph.ts](src/app/graph.ts) 的真实连线**永不漂移**。导出逻辑见 [src/app/topology.ts](src/app/topology.ts)。

## 配置与能力分层

[config/flow-agent.config.json](config/flow-agent.config.json)：标准 `agent` / `model` / `mcp` / `permissions` / `sandbox` / `skills` / `agentsDirectories` / `memory` / `compaction` / `middleware` 段（走 `loadFlowConfig` → 底层 `loadConfig`（[src/runtime/](src/runtime/)），Zod schema 校验）。自定义块加在顶层、用 `loadFlowConfig().raw` 取出（RAG 范例放 `rag` 段）。

**能力分层**（基础内置 / ACP 下发 / 环境 / 文件持久化）见 [docs/capabilities.md](docs/capabilities.md) 与 [.nuwax-agent/capability-sources.json](.nuwax-agent/capability-sources.json)——`capabilities` 命令查询当前可用工具/MCP/skills。

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

- [docs/node-catalog.md](docs/node-catalog.md) — **节点选型入口**（type 目录 + 何时用哪个）
- [docs/node-kit.md](docs/node-kit.md) — **factory catalog（建 flow 必读）**
- [docs/flow-patterns.md](docs/flow-patterns.md) — 进阶模式（Send/interrupt/Command/subgraph/checkpointer/长任务硬化）
- [docs/capabilities.md](docs/capabilities.md) · [docs/zed-debug.md](docs/zed-debug.md) · 各 `examples/*/README.md`
- **API 细节看源码**：`FlowRuntime`（[src/runtime/flow-runtime.ts](src/runtime/flow-runtime.ts)）、`FlowCallbacks`（[src/core/flow-types.ts](src/core/flow-types.ts)）、`createFlowRuntime`（[src/index.ts](src/index.ts)）、Surface Seam（[src/surfaces/](src/surfaces/)）、ACP hooks（[src/libs/deepagents-acp/](src/libs/deepagents-acp/)）、`createFlowTools`（[src/app/flow-tools.ts](src/app/flow-tools.ts)）
