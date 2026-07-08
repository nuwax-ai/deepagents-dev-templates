# 通用工作流编排模板

**通用工作流编排模板** —— Agent 按 **preset topology**（预先设计的 node + edge 图）跑 LangGraph 工作流，而不是自由的 tool loop。

> **两种获取方式**：
> - **源码开发**（git checkout，含 `src/`、`tsconfig`）：本目录 `pnpm install && pnpm build` 即可改默认图、生成场景 flow、扩展能力。
> - **平台压缩包**（`.tar.gz` / `.zip`，nuwax 打包格式）：内含已构建的 `dist/bundle.mjs`（单文件打包，不依赖 `node_modules`），由主平台直接运行，**无需 `build`**。

本项目是 **工作流编排 Agent**（显式 LangGraph 图），与 Coding Agent（tool loop）产品形态不同；运行时基础能力由项目内置底层运行时（`src/runtime/`）承担，「大脑」是一张可设计的节点图。

> **本文档**介绍当前工作目录的项目结构、分层规则、命令与检查清单；API 细节见源码与 `docs/`。

## 快速开始

```bash
pnpm install && pnpm build
pnpm flow "你好"          # CLI；无凭证走 fallback 也能跑
pnpm smoke                # **推荐** ACP 验证：rcoder-cli 驱动真实 ACP 会话（握手 → onPrompt → 整图 → 流式答案）；`-- --dry-run` 仅打印命令
```

**拼你自己的 flow** = 组合 `src/libs/nodes/` 的节点 factory + 在 `src/app/graph.ts` 连线：

```ts
import { createLlmStreamNode, createHumanApprovalNode } from "./libs/nodes/index.js";

const gen = createLlmStreamNode<S>({
  model: () => model,
  prompt: (s) => [/* msgs */],
  write: (r) => ({ draft: r.text }),
});
const review = createHumanApprovalNode<S>({ question: (s) => `草稿:${s.draft},ok?`, write: (fb) => ({ feedback: fb }) });

const graph = new StateGraph(S)
  .addNode("gen", gen).addNode("review", review)
  .addEdge(START, "gen").addEdge("gen", "review").addEdge("review", END)
  .compile({ checkpointer });
```

- **节点选型**见 [docs/node-catalog.md](docs/node-catalog.md)；**factory API** 见 [docs/node-kit.md](docs/node-kit.md)
- **一句话需求 → flow**：`scripts/scaffold/`（9 topologies：8 presets = react-tools / human-in-loop / project-manager / travel-planner / rag / adaptive-rag / deep-research / dev-agent + `custom` 任意节点级编排）
- 进阶模式（Send / interrupt / subgraph / **durable stateful flow**）见 [docs/flow-patterns.md](docs/flow-patterns.md)
- 场景演示：对照 [src/libs/topologies/](src/libs/topologies/) + [scripts/scaffold/specs/](scripts/scaffold/specs/) → 生成到 `src/app/flows/`

## 项目结构 + 分层

```
src/
  core/          纯类型契约（各层共享）
  runtime/       底层运行时（config/model/logger/mcp/checkpoint/llm-resilience + flow-config/flow-runtime）
  libs/          ★ 可复用构建件（保护、消费不改）
    nodes/         节点 factory + 原语（建 flow 用，见 node-kit.md）+ model-resolver（凭证策略）
    tools/         内置通用工具（bash/fs/grep·glob/demo/http/json/skill；MCP 工具由 runtime 经 @langchain/mcp-adapters 原生注入，非 toolkit 静态导出）
    topologies/    topology building blocks（adaptive-rag/rag/deep-research/human-in-loop/project-manager/travel-planner；图逻辑单一权威 graph/topology/recipe；scaffold 生成薄封装复用；单向依赖 nodes/+mcp/；react-tools 复用默认图）
    mcp/           stdio MCP 客户端（callResolvedMcpTool/rateLimited；零 src import，自包含）
    deepagents-acp/  vendored ACP SDK（自包含）
  app/           默认 ReAct 图（★ 可改、开发工作区）：graph.ts + nodes/ + flow-tools/task + state/topology/default-flow + flows/（注册表 + scaffold 薄封装 + 内置 dev-agent）
  surfaces/      ACP/CLI 适配器（保护）：acp/ cli/ + stateful-flow/map-stream-chunk/...
  index.ts       入口 + 组合根（createFlowRuntime + materializeFlow 桥接 stateful-recipe）
config/ prompts/ skills/ scripts/ docs/ tests/
```

**Layering** — imports only flow leftward: **`core → runtime → libs → app → surfaces → index.ts`**. Within `libs`, `nodes` / `tools` / `deepagents-acp` / `mcp` do not cross-import; `topologies/` may depend on `nodes/` + `mcp/` only (never the reverse). `tests/layering.test.ts` enforces this (`layerOf` at libs top-level); **no exceptions**.

## 建 flow

**Reuse unit = node factories in `src/libs/nodes/`** — generic over `State`, wired with `prompt(state)` / `write(result, state)`; not hand-written node bodies. See **[docs/node-kit.md](docs/node-kit.md)**:

`createLlmNode` · `createLlmStreamNode` · `createLlmRouterNode`（LLM 裁决 → Command goto）· `createToolExecNode` · `createHumanApprovalNode`（HITL 前置 interrupt）· `createApprovalFinalizeNode`（HITL 后置定稿）· `createMcpRetrievalNode`（主动 MCP 检索）· `createPrepareNode` · `createFanout` · `createSubgraphNode`

> **Bespoke nodes** — do not force into a factory (multi-source retrieval merge, file delivery, converse routing, etc.); keep hand-written. See topology comments and [node-catalog.md](docs/node-catalog.md) § BESPOKE.

两种方式落地：

1. **脚手架优先**（一句话 / 简单场景）：写 spec → `node scripts/scaffold/generate.mjs <spec>` → 改 `config/flow-agent.config.json` 的 `activeFlow`（自带 typecheck+graph 自验）
2. **直接改默认图**：编辑 [src/app/graph.ts](src/app/graph.ts) 连线 + [src/app/nodes/](src/app/nodes/) 节点逻辑；进阶形态对照 [src/libs/topologies/](src/libs/topologies/)，落盘对照 [scripts/scaffold/specs/](scripts/scaffold/specs/) → `src/app/flows/`

**多 flow 选图**：`config/flow-agent.config.json` 顶层 `activeFlow`（缺省 `default`）经 [src/app/flows/index.ts](src/app/flows/index.ts) 注册表解析——`flow` / `graph` / ACP 三条入口共用。内置 flow（各代表一类形态）：`default`（conversational ReAct 泛化底座）、`dev-agent`（stateful-custom：ReAct + 压缩）、`search-aggregator`（conversational + 平台能力样板，**零图路径**：default 底座 + systemPrompt，平台登记的能力运行期进入 `allTools` 后自动 bind）、`translate-review`（one-shot 流式管道教学）、`router-gate`（LLM 路由教学）。更多形态见 `src/libs/topologies/`；场景 spec 范例在 `scripts/scaffold/specs/`。`pnpm graph` 导出**当前 activeFlow** 的 graph topology。

**两类 flow**（[src/core/flow-types.ts](src/core/flow-types.ts)）：
- `FlowExecutor`：one-shot，`(query, cb) => Promise<FlowResult>`。无记忆单次调用（见 `src/libs/topologies/rag`）。
- `StatefulFlow`：支持 human-in-the-loop，`run({query|resume}, threadId, cb) => {done|interrupted}`。图里 `interrupt` 暂停 → surface 把问题发给用户 → 下一轮 `resume`。**别手写 run-loop**——用 `createStatefulFlow`（[src/surfaces/stateful-flow.ts](src/surfaces/stateful-flow.ts)），它有**两种用法**：
  - **HITL durable stateful flow**（默认）：暴露 `hasStarted`，首条 query 开题、之后续跑同一任务（`resume` 走 interrupt 续跑）。
  - **conversational 对话**（`conversational: true`，如 default / search-aggregator）：不暴露 `hasStarted`，surface 每轮走 query + 稳定 threadId + checkpointer → 多轮记忆；图层 `graph.stream` 真流式。详见 [docs/flow-patterns.md](docs/flow-patterns.md) 第 6 节。

## 开发规则

- **图是契约** — 连线/条件路由在 `graph.ts`；节点优先 factory、bespoke 才手写到 `nodes/`；决策逻辑抽纯函数 + 单测。
- **先 factory 后手写** — 节点先查 [node-kit.md](docs/node-kit.md)；bespoke 保留并注释「为何不用 factory」。
- **保护区** — `core`/`runtime`/`libs`/`surfaces` 默认不改；`src/app/` 可改。
- **有状态用基座** — `createStatefulFlow`，不手写 run-loop。
- **工具顺序** — native MCP（`config/mcp.default.json` + ACP session 合并）→ `libs/tools` 内置（bash/fs/grep·glob/http/json）→ 自写代码。
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
工具集来自 `FlowRuntime.allTools`（[src/app/flow-tools.ts](src/app/flow-tools.ts)）：bash / 文件读写 / grep·glob / http / json + **native MCP**（经 `@langchain/mcp-adapters` 加载；**开发期**平台 `mcpConfigs` 登记 + **运行期** ACP session `mcpServers` 合并 `config/mcp.default.json`，默认 session-wins；**内置 `ask-question`（结构化提问 fallback），不内置搜索/文档 server**）+ demo(echo/calculate/time) + 可选 `load_skill` / `task`（子智能体 subagent 委派，流式透出 token 与 `[subagent] tool` 调用）。
无模型凭证时 think 走 fallback（回显输入），图始终可跑、可测。见 [src/app/graph.ts](src/app/graph.ts)。

**进阶模式**（并行 fan-out、HITL `interrupt`、subgraph 子智能体（subagent）、压缩、**durable stateful flow**：cross-restart resume / stage progress / recursion guard）见 [docs/flow-patterns.md](docs/flow-patterns.md)；
能力分层与配置见 [docs/capabilities.md](docs/capabilities.md)。

## Topology 积木：不同需求 → 不同图

| Topology | 需求类型 | LangGraph 特性 | 单一权威 | 挂载方式 |
|---|---|---|---|---|
| `react-tools` | 通用工具对话 | `bindTools` + `ToolNode` | [默认图](src/app/graph.ts) | `pnpm flow`（`activeFlow: default`） |
| `rag` | 检索增强问答 | 线性 + 条件重试 | [libs/topologies/rag](src/libs/topologies/rag/) | scaffold → `app/flows/` |
| `adaptive-rag` | 自适应检索问答 | 路由 + 检索/生成双自纠正 | [libs/topologies/adaptive-rag](src/libs/topologies/adaptive-rag/) | scaffold spec |
| `travel-planner` | 并行调研聚合 | `Send` 扇出 + reducer + HITL | [libs/topologies/travel-planner](src/libs/topologies/travel-planner/) | scaffold → `app/flows/` |
| `project-manager` | 分解-评估-审批 | reflection 回边 + HITL | [libs/topologies/project-manager](src/libs/topologies/project-manager/) | scaffold → `app/flows/` |
| `human-in-loop` | 生成→人审→定稿 | ask-question MCP（内置 fallback）+ `interrupt` + `Command(resume)` | [libs/topologies/human-in-loop](src/libs/topologies/human-in-loop/) | scaffold → `app/flows/` |
| `deep-research` | 深度研究报告 | 多阶段 + 双层 reflection + 持续会话 | [libs/topologies/deep-research](src/libs/topologies/deep-research/) | scaffold → `app/flows/` |
| `dev-agent` | 综合工具助手 | ReAct + 压缩 | [app/flows/dev-agent](src/app/flows/dev-agent/) | 内置 `activeFlow: "dev-agent"` |

这些 topology 由 scaffold 生成薄封装后注册到 `src/app/flows/`（`dev-agent` 为内置 stateful-custom）；surface 接入统一走 `FlowExecutor` / `StatefulFlow`，不重写 ACP/CLI plumbing。有状态 topology 通过 `createStatefulFlow` 统一 interrupt/resume、checkpoint 与跨进程恢复。节点和边以「单一权威」列为准；示范 spec 见 `scripts/scaffold/specs/`。

**关键接入层（seam）**：surface 与具体图解耦。[src/surfaces/acp/server.ts](src/surfaces/acp/server.ts) 的 `bootstrapFlowAcp` 和 [src/surfaces/cli/run.ts](src/surfaces/cli/run.ts) 的 `runFlowCli` 按 `typeof executor` 自动分流两类 flow。ACP 路径用 deepagents-acp 的 `onPrompt` 钩子跑 executor、经 `conn` 流式回传、返回 `{ stopReason }` **绕过 deep agent 默认循环**。

## 运行

在项目根目录（本 `package.json` 所在目录）：

```bash
pnpm install && pnpm build

# 默认 flow：CLI（尊重 config.activeFlow）
pnpm flow "随便说点什么"
pnpm exec tsx src/index.ts flow -i

# 默认 flow：ACP 服务（供 Zed / JetBrains 等 ACP host）
pnpm start:acp

# Export graph topology / 能力查询 / 会话
pnpm graph                              # 当前 activeFlow graph topology JSON；加 --mermaid 输出 Mermaid
pnpm exec tsx src/index.ts capabilities # 无凭证，工具/MCP/skills/subagents
pnpm exec tsx src/index.ts sessions     # 已持久化会话
pnpm exec tsx src/index.ts sessions delete <thread-id>

# 可选：--config <path> 指定配置文件（默认 config/flow-agent.config.json）

# 场景 flow：scaffold 生成到 app/flows → 设 activeFlow → 跑 smoke
# node scripts/scaffold/generate.mjs scripts/scaffold/specs/_example.knowledge-qa.flow.json
# （再编辑 config/flow-agent.config.json 的 activeFlow）

# 验证
pnpm test && pnpm typecheck
pnpm smoke                          # 当前 activeFlow ACP 冒烟（-- --dry-run 仅打印）
pnpm smoke -- --entry src/index.ts  # 显式入口
```

模型凭证见 [`.env.example`](.env.example)（ACP 模式下通常由 IDE host 注入）。

## 调试

| 目标 | 命令 |
|---|---|
| 默认 flow CLI | `pnpm flow "..."` / `pnpm exec tsx src/index.ts flow -i` |
| Export graph topology | `pnpm graph`（JSON）/ `pnpm graph --mermaid`（Mermaid 源） |
| 能力分层查询 | `pnpm exec tsx src/index.ts capabilities`（无凭证，工具/MCP/skills/subagents） |
| 已持久化会话 | `pnpm exec tsx src/index.ts sessions` / `sessions delete <id>` |
| 默认 flow ACP 冒烟（rcoder） | `pnpm smoke` |
| 任意入口 ACP 冒烟 | `pnpm smoke -- --entry <path>` |
| 类型检查 | `pnpm typecheck` |

`pnpm smoke` 用 rcoder-cli 端到端驱动 ACP（握手 → `onPrompt` → 整图 → 流式答案）；读 `config.activeFlow`。`--entry PATH` 或 `AGENT_ENTRY` 可指向其他入口。
**在 Zed 里 chat 调试**当前 `activeFlow` 的 `agent_servers` 配置见 [docs/zed-debug.md](docs/zed-debug.md)。

## Export graph topology（可视化对接）

显式 StateGraph 的好处之一：节点连线是**静态可提取**的。`./topology` 把编译图反射成结构化数据（不运行图、不需要凭证），供 inspector / 文档 / 调试器消费：

```bash
pnpm graph              # → 当前 activeFlow 的 { nodes, edges } JSON
pnpm graph --mermaid    # → Mermaid 源，可直接渲染
```

```ts
// 工作区内
import { getFlowTopology } from "./src/app/topology.js";
const { nodes, edges, mermaid } = await getFlowTopology();
```

`edges[].conditional` 标出条件边（如 `reflect → think|respond`），数据来自 `getGraphAsync()`，与 [src/app/graph.ts](src/app/graph.ts) 的真实连线**永不漂移**。导出逻辑见 [src/app/topology.ts](src/app/topology.ts)。

## 配置与能力分层

[config/flow-agent.config.json](config/flow-agent.config.json)：标准 `agent` / `model` / `mcp` / `permissions` / `sandbox` / `skills` / `agentsDirectories` / `memory` / `compaction` / `middleware` 段，以及顶层 **`activeFlow`**（选 [src/app/flows/](src/app/flows/) 注册表中的 flow；缺省 `default`）。配置走 `loadFlowConfig` → 底层 `loadConfig`（[src/runtime/](src/runtime/)），Zod schema 校验。自定义块加在顶层、用 `loadFlowConfig().raw` 取出。

**能力分层**（工作区配置 / 内置 / 环境 / 文件持久化）见 [docs/capabilities.md](docs/capabilities.md) 与 [.nuwax-agent/capability-sources.json](.nuwax-agent/capability-sources.json)——`capabilities` 命令查询当前可用工具/MCP/skills/子智能体（subagents）。

**版本同步**：以 `package.json` 的 `version` 为权威源；`pnpm version:sync` 同步 `agent.version` 与 `.nuwax-agent/agent-package.json` 发布元数据（`pnpm package` 前置 `version:check`）。

默认模型 `openai / deepseek-chat`（见 [config/flow-agent.config.json](config/flow-agent.config.json)，已对齐国内 OpenAI 兼容端点；切回 Anthropic 把 `model.provider` 设为 `anthropic`）。各端点配置见 [`.env.example`](.env.example)。

> 升级提示：会话/checkpoint 默认目录已从项目内 `./.flow-sessions` 调整为用户目录 `~/.flowagents/<workspace 散列>/`。如果需要继续读取旧会话，把 `config.memory.dir` 显式设回 `./.flow-sessions`；新项目建议保留默认值，避免会话文件混进源码包。

## 测试

```bash
pnpm test
```

- `tests/` — 默认图（条件边决策表 + 收敛）、纯函数、graph topology 导出、分层守卫（`layering.test.ts`）
- `tests/topologies/` — 积木拓扑回归（RAG 重试、并行/HITL、deep-research 收敛等）

## 提交前检查

- [ ] 无硬编码密钥 · 无 `any` · import 带 `.js` 后缀
- [ ] 节点名不与 state channel 同名 · 决策函数（条件边路由）有单测
- [ ] 分层合规（`layering.test.ts` 绿）· runtime 自包含（无仓库外路径）

## 流式输出检查清单

用户可见的大段 LLM 输出（compose / aggregate / draft / finalize 修订等）需满足：

1. **选对 factory**：用 `createLlmStreamNode`（`write` 读 `r.text`），不要用 `createLlmNode`（仅 `invoke`，无逐 token）
2. **Surface 注入 onToken**：经 `createStatefulFlow` / ACP / CLI 跑图时，`configurable.onToken` 已自动注入；自建 runner 需手动传入 `FlowCallbacks.onToken`
3. **模型支持 stream**：底层 ChatModel 需实现 `.stream()`；否则 `streamLLMText` 退回一次性 invoke，ACP 再在 turn 末整段兜底

降级链：真流式（L1）→ invoke 一次（L2）→ ACP 整段 `streamText`（L3），保证用户总能看到结果。详见 [docs/node-kit.md](docs/node-kit.md) § createLlmStreamNode。

## 联网 / 外部检索

> **需要联网搜索时**：当前项目**不提供**开箱即用的网页搜索。必须到**平台**查找并添加（开发 Agent 经 `dev-engineer-toolkit`：`search-apis.sh` → `add-tool.sh`）。**登记即接入**：平台已登记的工具能力（Plugin / Workflow / Knowledge 等）由平台在运行期适配为可用工具并注入 `FlowRuntime.allTools`；conversational ReAct 的 `think ↔ tools` 可零代码使用，固定管道可在节点 `params` 写工具名（`platform-tool` 用 `toolName`，`tool-exec` 用 `tools`）选择工具集合。禁止为已登记能力手写 fetch / `tool()` 包装；禁止用 `bash`+curl / `http_request` 替代；禁止在项目配置内硬编码搜索服务。

| 能力 | 代码落点 | 说明 |
|------|----------|------|
| 工作区检索 | `grep` / `glob` 工具（`createSearchTools`） | **非**联网；ReAct 默认图经 `flow-tools.ts` 注册 |
| **平台能力对话（零图路径）** | `src/app/flows/search-aggregator/` | default ReAct 底座 + systemPrompt；平台登记的搜索能力运行期进入 `allTools` 后自动 bind，零接线 |
| 固定管道工具节点 | `createPlatformToolActionNode` / `createToolExecNode` / `createMcpRetrievalNode` | 按节点 `params.toolName` / `params.tools` 引用平台工具；现有检索型 topology 仍可使用 MCP 检索节点 |
| 自适应 RAG 网页搜索 | `adaptive-rag` `createWebSearchNode` + `searchMcp` | 平台登记搜索能力后接入；运行期由平台适配后注入工具集 |
| 未配置搜索源 | `travel-planner` research；`search-aggregator` 提示词 | `searchMcp` 缺省 → 优雅降级（提示去平台添加）；样板无搜索工具时如实告知；须开发期已搜平台举证 |
| **运行时注入** | `src/runtime/` / `src/app/flow-tools.ts` | 平台会话能力与项目配置汇总为 runtime 工具集 |
| **真实调用验证** | `SMOKE_EXPECT_TOOL=<子串> pnpm smoke` | 轨迹须现该工具调用且 done 非空，否则 exit 1（防 LLM 兜底假绿） |

云开发环境中平台 Plugin / Workflow / Knowledge 等工具登记由**开发 Agent 技能包**引导（见 README § 扩展阅读），不在当前项目 `src/` 内实现。

## 扩展阅读

本仓库 `docs/` **只描述当前工作目录内的能力、配置与图规则**；在云开发环境中，开发 Agent 的脚手架流程、平台登记与完成检查（技能包闸门）由**独立注入的技能包**引导（与项目源码分离，不随平台压缩包下发）。

- [docs/flow-orchestration.md](docs/flow-orchestration.md) — **编排速查**（框架优先 / 核心编排模式 / 命名坑 / 能力来源）
- [docs/node-catalog.md](docs/node-catalog.md) — **节点选型入口**（type 目录 + 何时用哪个）
- [docs/flow-graph-rules.md](docs/flow-graph-rules.md) — **图编排规则**（R-G001+，可持续追加）
- [docs/node-kit.md](docs/node-kit.md) — **factory catalog（建 flow 必读）**
- [docs/troubleshooting.md](docs/troubleshooting.md) — **排错索引**（`LLM 未返回 JSON` / Invalid edge / HITL / spec 漂移）
- [docs/flow-patterns.md](docs/flow-patterns.md) — 进阶模式（Send/interrupt/Command/subgraph/checkpointer/durable stateful flow）
- [docs/glossary.md](docs/glossary.md) — **术语对照表**（durable stateful flow / topology / **平台侧** / **平台问答卡片** 等，统一指代、防漂移）
- [docs/zed-debug.md](docs/zed-debug.md) — Zed / ACP 调试
- [scripts/scaffold/specs/](scripts/scaffold/specs/) — 场景 flow 示范（scaffold → `app/flows`）
- **API 细节看源码**：`FlowRuntime`（[src/runtime/flow-runtime.ts](src/runtime/flow-runtime.ts)）、`FlowCallbacks`（[src/core/flow-types.ts](src/core/flow-types.ts)）、`createFlowRuntime`（[src/index.ts](src/index.ts)）、Surface Seam（[src/surfaces/](src/surfaces/)）、ACP hooks（[src/libs/deepagents-acp/](src/libs/deepagents-acp/)）、`createFlowTools`（[src/app/flow-tools.ts](src/app/flow-tools.ts)）
