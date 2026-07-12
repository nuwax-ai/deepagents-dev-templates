# 通用工作流编排模板

**通用工作流编排模板** —— Agent 按**显式设计的 node + edge 图**（LangGraph StateGraph）跑工作流，而不是自由的 tool loop。

本项目是 **工作流编排 Agent**（显式 LangGraph 图），与 Coding Agent（tool loop）产品形态不同；运行时基础能力由项目内置底层运行时（`src/runtime/`）承担，「大脑」是一张可设计的节点图。

> **开发方式**：源码工作区直接改图、用 `tsx` 跑命令（**迭代期不要 `pnpm build`**，避免阻塞）。本地快检：`pnpm flow`；查 profile：`pnpm flows -- --json`。**勿用 `pnpm exec tsx`**（pnpm 10/11 混用易卡在 exec 前预检）。端到端在平台预览会话经 ACP surface 验证。

> **本文档**介绍当前工作目录的项目结构、分层规则、命令与检查清单；API 细节见源码与 [`docs/`](docs/README.md)。

## 快速开始

```bash
pnpm install
pnpm flow "你好"          # 经 tsx 直跑；无凭证走 fallback 也能跑
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
- **多轮 chat / 检索 / 平台能力**：直接改 [src/app/graph.ts](src/app/graph.ts) 或对照 [docs/examples.md](docs/examples.md)（仅文档，无内置 demo）
- 进阶模式（Send / interrupt / subgraph / **durable stateful flow**）见 [docs/flow-patterns.md](docs/flow-patterns.md)

## 项目结构 + 分层

```
src/
  core/          纯类型契约（各层共享）
  runtime/       底层运行时（config/model/logger/mcp/checkpoint/llm-resilience + flow-config/flow-runtime）
  libs/          ★ 可复用构建件（保护、消费不改）
    nodes/         节点 factory + 原语（建 flow 用，见 node-kit.md）+ model-resolver（凭证策略）
    tools/         内置通用工具（bash/fs/grep·glob/demo/http/json/skill；MCP 工具由 runtime 经 @langchain/mcp-adapters 原生注入，非 toolkit 静态导出）
    mcp/           MCP 访问层（callResolvedMcpTool/rateLimited；仅依赖 runtime，自包含）
    deepagents-acp/  vendored ACP SDK（自包含）
  app/           默认 ReAct 图（★ 可改、开发工作区）：graph.ts + nodes/ + flow-tools/task + state/topology/default-flow + flows/（注册表仅 default）
  surfaces/      ACP/CLI 适配器（保护）：acp/ cli/ + stateful-flow/map-stream-chunk/...
  index.ts       入口 + 组合根（createFlowRuntime + materializeFlow 桥接 stateful-recipe）
config/ prompts/ skills/ scripts/ docs/ tests/
```

**Layering** — imports only flow leftward: **`core → runtime → libs → app → surfaces → index.ts`**. Within `libs`, `nodes` / `tools` / `deepagents-acp` / `mcp` do not cross-import. `tests/layering.test.ts` enforces this (`layerOf` at libs top-level); **no exceptions**.

## 建 flow

**Reuse unit = node factories in `src/libs/nodes/`** — generic over `State`, wired with `prompt(state)` / `write(result, state)`; not hand-written node bodies. See **[docs/node-kit.md](docs/node-kit.md)**:

`createLlmNode` · `createLlmStreamNode` · `createLlmRouterNode`（LLM 裁决 → Command goto）· `createToolExecNode` · `createHumanApprovalNode`（HITL 前置 interrupt）· `createApprovalFinalizeNode`（HITL 后置定稿）· `createMcpRetrievalNode`（主动 MCP 检索）· `createPrepareNode` · `createFanout` · `createSubgraphNode`

> **Bespoke nodes** — do not force into a factory (multi-source retrieval merge, file delivery, converse routing, etc.); keep hand-written. See [node-catalog.md](docs/node-catalog.md) § BESPOKE。

落地方式：

1. **默认多轮 chat**：保持 `flow.active: "default"`，改 [src/app/graph.ts](src/app/graph.ts) / systemPrompt / 平台能力登记
2. **进阶形态**：组合 `libs/nodes` factory 在 `graph.ts` 连线；对照 [docs/examples.md](docs/examples.md) 与 [docs/flow-patterns.md](docs/flow-patterns.md)

**选图**：`config/flow-agent.config.json` 的 `flow.active`（缺省 `default`；旧顶层 `activeFlow` 兼容读取）经 [src/app/flows/index.ts](src/app/flows/index.ts) 解析——注册表**仅 default**。`pnpm graph` 导出默认图 topology。

**StatefulFlow**（[src/core/flow-types.ts](src/core/flow-types.ts)）：支持 human-in-the-loop，`run({query|resume}, threadId, cb) => {done|interrupted}`。图里 `interrupt` 暂停 → surface 把问题发给用户 → 下一轮 `resume`。**别手写 run-loop**——用 `createStatefulFlow`（[src/surfaces/stateful-flow.ts](src/surfaces/stateful-flow.ts)）：
  - **HITL durable stateful flow**：暴露 `hasStarted`，首条 query 开题、之后续跑同一任务（`resume` 走 interrupt 续跑）。
  - **conversational 对话**（default）：不暴露 `hasStarted`，surface 每轮走 query + 稳定 threadId + checkpointer → 多轮记忆 + 入口自动压缩；图层 `graph.stream` 真流式。物化开关：`FlowDef.conversational` 优先，未设则 `profile.interaction === "chat"`。详见 [docs/flow-patterns.md](docs/flow-patterns.md) 第 6 节。

## 开发规则

- **图是契约** — 连线/条件路由在 `graph.ts`；节点优先 factory、bespoke 才手写到 `nodes/`；决策逻辑抽纯函数 + 单测。
- **先 factory 后手写** — 节点先查 [node-kit.md](docs/node-kit.md)；bespoke 保留并注释「为何不用 factory」。
- **保护区** — `core`/`runtime`/`libs`/`surfaces` 默认不改；`src/app/` 可改。
- **有状态用基座** — `createStatefulFlow`，不手写 run-loop。
- **工具顺序** — native MCP（`config/mcp.default.json` + ACP session 合并）→ `libs/tools` 内置（bash/fs/grep·glob/http/json）→ 自写代码。
- **密钥** — 环境变量，禁止硬编码。
- **依赖只在本仓库** — 缺能力 `pnpm install` / 在 `src/runtime/` 扩展 / copy-in，不引仓库外路径。

## 默认图（唯一产品入口）

开箱即用的默认图是标准 ReAct，经 **StatefulFlow conversational** 运行（稳定 threadId + checkpointer 多轮记忆 + `graph.stream` 真流式；见 [src/app/default-flow.ts](src/app/default-flow.ts)）。工具/持久化全用框架原生能力：

```
START → prepare → think(model.bindTools) ──(toolsCondition)──┐
                      ▲                                      ├─ 有 tool_calls → tools(ToolNode + onToolCall 透出) → think
                      └──────────────────────────────────────┘
                                               └─ 无 tool_calls → respond(流式) → END
```

| 节点 | 职责 | 框架能力 |
|---|---|---|
| `prepare` | input → HumanMessage（追加到 Messages 历史） | `MessagesAnnotation` |
| `think` | `bindTools` 模型决定调工具或回答 | 原生 function-calling |
| `tools` | 执行 tool_calls + `onToolCall` 三态透出 | prebuilt `ToolNode` + `toolsCondition` |
| `respond` | 取回答流式输出（onToken） | — |

状态用标准消息流（`MessagesAnnotation`），自动进 `FileCheckpointSaver`（跨重启恢复 + interrupt/resume）。
**会话压缩**不在 `prepare` 内：由 `createStatefulFlow` 在每轮新 `query` 入口调用 `applyCompaction`（消费 `config.compaction`）。
工具集来自 `FlowRuntime.allTools`（[src/app/flow-tools.ts](src/app/flow-tools.ts)）：bash / 文件读写 / grep·glob / http / json + **native MCP**（经 `@langchain/mcp-adapters` 加载；**开发期**平台 `mcpConfigs` 登记 + **运行期** ACP session `mcpServers` 合并 `config/mcp.default.json`，默认 session-wins；**内置 `ask-question`（结构化提问 fallback），不内置搜索/文档 server**）+ demo(echo/calculate/time) + 可选 `load_skill` / `task`（子智能体 subagent 委派，流式透出 token 与 `[subagent] tool` 调用）。
无模型凭证时 think 走 fallback（回显输入），图始终可跑、可测。见 [src/app/graph.ts](src/app/graph.ts)。

能力分层与配置见 [docs/capabilities.md](docs/capabilities.md)。扩展思路见 [docs/examples.md](docs/examples.md)（仅文档）。

**关键接入层（seam）**：surface 与具体图解耦。[src/surfaces/acp/server.ts](src/surfaces/acp/server.ts) 的 `bootstrapFlowAcp` 和 [src/surfaces/cli/run.ts](src/surfaces/cli/run.ts) 的 `runFlowCli` 按 `typeof executor` 自动分流 flow。ACP 路径用 deepagents-acp 的 `onPrompt` 钩子跑 executor、经 `conn` 流式回传、返回 `{ stopReason }` **绕过 deep agent 默认循环**。

## 运行

在项目根目录（本 `package.json` 所在目录）：

```bash
pnpm install

# 默认 flow：CLI 快检（尊重 config.flow.active；底层 tsx，无需 build）
pnpm flow "随便说点什么"
pnpm flow -- -i

# 图拓扑 / 能力 / 会话（走 package.json scripts，避免 pnpm exec）
pnpm graph              # JSON；加 -- --mermaid 输出 Mermaid
pnpm capabilities     # 无凭证
pnpm flows -- --json
pnpm sessions

# 静态检查（迭代友好，无 build）
pnpm typecheck && pnpm test
```

模型凭证见 [`.env.example`](.env.example)（平台预览会话由 ACP 宿主注入；本地 CLI 可复制 `.env`）。

## 调试

| 目标 | 方式 |
|---|---|
| 本地快检 | `pnpm flow "..."` / `pnpm flow -- -i` |
| 端到端（平台预览） | ACP surface + 平台预览会话（`config.flow.active`） |
| 日志 | 读 `.logs/`（`LOG_DIR=<REPO>/.logs`，`LOG_LEVEL=debug`） |
| Export graph topology | `pnpm graph`（`pnpm graph -- --mermaid`） |
| 能力 / flow profile | `pnpm capabilities` / `pnpm flows -- --json` |
| 类型检查 | `pnpm typecheck` |

> 迭代期优先 `pnpm flow` 短 prompt；**不要**为日常调试跑 `pnpm build`。

## Export graph topology（可视化对接）

显式 StateGraph 的好处之一：节点连线是**静态可提取**的。`./topology` 把编译图反射成结构化数据（不运行图、不需要凭证），供 inspector / 文档 / 调试器消费：

```bash
pnpm graph              # → 当前 active flow 的 { nodes, edges } JSON
pnpm graph --mermaid    # → Mermaid 源，可直接渲染
```

```ts
// 工作区内
import { getFlowTopology } from "./src/app/topology.js";
const { nodes, edges, mermaid } = await getFlowTopology();
```

`edges[].conditional` 标出条件边（如默认图 `think → tools|respond`），数据来自 `getGraphAsync()`，与 [src/app/graph.ts](src/app/graph.ts) 的真实连线**永不漂移**。导出逻辑见 [src/app/topology.ts](src/app/topology.ts)。

## 配置与能力分层

[config/flow-agent.config.json](config/flow-agent.config.json)：标准 `agent` / `model` / `mcp` / `permissions` / `sandbox` / `skills` / `agentsDirectories` / `memory` / `compaction` / `middleware` 段，以及正式 **`flow.active`**（选 [src/app/flows/](src/app/flows/) 注册表中的 flow；缺省 `default`；旧 `activeFlow` 仅兼容读取）。配置走 `loadFlowConfig` → 底层 `loadConfig`（[src/runtime/](src/runtime/)），Zod schema 校验。自定义块加在顶层、用 `loadFlowConfig().raw` 取出。

**能力分层**（工作区配置 / 内置 / 环境 / 文件持久化）见 [docs/capabilities.md](docs/capabilities.md) 与 [.nuwax-agent/capability-sources.json](.nuwax-agent/capability-sources.json)——`capabilities` 命令查询当前可用工具/MCP/skills/子智能体（subagents）。

默认模型 `openai / deepseek-chat`（见 [config/flow-agent.config.json](config/flow-agent.config.json)，已对齐国内 OpenAI 兼容端点；切回 Anthropic 把 `model.provider` 设为 `anthropic`）。各端点配置见 [`.env.example`](.env.example)。

> 升级提示：会话/checkpoint 默认目录已从项目内 `./.flow-sessions` 调整为用户目录 `~/.flowagents/<workspace 散列>/`。如果需要继续读取旧会话，把 `config.memory.dir` 显式设回 `./.flow-sessions`；新项目建议保留默认值，避免会话文件混进工作区。

## 测试

```bash
pnpm test
```

- `tests/` — 默认图（条件边决策表 + 收敛）、纯函数、graph topology 导出、分层守卫（`layering.test.ts`）

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

> **需要联网搜索时**：当前项目**不提供**开箱即用的网页搜索。须在**平台侧**登记搜索能力（Plugin / Workflow / Knowledge 等）。已登记工具可经宿主注入，或把真实 schema 固化为 **`FlowDef.platformToolRefs`** 再经 `createFlowRuntime` 装配为 `StructuredTool`。conversational ReAct 便捷路径是并入 `allTools` 后 `think ↔ tools` 零代码使用；固定管道用 `createPlatformToolActionNode({ toolName, tools })` / `createToolExecNode({ tools })` / `createMcpRetrievalNode` 传入独立节点或局部工具集合（`tools` 来自固化产物或注入子集，**不必**全部进 `allTools`）。禁止为已登记能力手写 fetch / `tool()` 包装；禁止用 `bash`+curl / `http_request` 替代；禁止在项目配置内硬编码搜索服务。

| 能力 | 说明 |
|------|------|
| 工作区检索 | `grep` / `glob` 工具（`createSearchTools`）；**非**联网；ReAct 默认图经 `flow-tools.ts` 注册 |
| **平台能力对话** | 改 default 图 systemPrompt + 平台登记搜索/知识工具；可并入 `allTools` 供 ReAct bind，或按节点/集合接线 |
| 固定管道工具节点 | `createPlatformToolActionNode` / `createToolExecNode` / `createMcpRetrievalNode` |
| **运行时注入** | `src/runtime/` / `src/app/flow-tools.ts`；平台会话能力与项目配置汇总为 runtime 工具集 |

平台 Plugin / Workflow / Knowledge 等工具登记在**平台侧**完成，不在当前项目 `src/` 内实现。

## 扩展阅读

本仓库 `docs/` 只描述当前工作目录内的能力、配置与图规则。

- [docs/examples.md](docs/examples.md) — **扩展思路（仅文档，无内置 demo）**
- [docs/flow-orchestration.md](docs/flow-orchestration.md) — **编排速查**（框架优先 / 核心编排模式 / 命名坑 / 能力来源）
- [docs/node-catalog.md](docs/node-catalog.md) — **节点选型入口**（type 目录 + 何时用哪个）
- [docs/flow-graph-rules.md](docs/flow-graph-rules.md) — **图编排规则**（R-G001+，可持续追加）
- [docs/node-kit.md](docs/node-kit.md) — **factory catalog（建 flow 必读）**
- [docs/troubleshooting.md](docs/troubleshooting.md) — **排错索引**（`LLM 未返回 JSON` / Invalid edge / HITL / 图与文档漂移）
- [docs/flow-patterns.md](docs/flow-patterns.md) — 进阶模式（Send/interrupt/Command/subgraph/checkpointer/durable stateful flow）
- [docs/glossary.md](docs/glossary.md) — **术语对照表**
- **API 细节看源码**：`FlowRuntime`（[src/runtime/flow-runtime.ts](src/runtime/flow-runtime.ts)）、`FlowCallbacks`（[src/core/flow-types.ts](src/core/flow-types.ts)）、`createFlowRuntime`（[src/index.ts](src/index.ts)）、Surface Seam（[src/surfaces/](src/surfaces/)）、ACP hooks（[src/libs/deepagents-acp/](src/libs/deepagents-acp/)）、`createFlowTools`（[src/app/flow-tools.ts](src/app/flow-tools.ts)）
