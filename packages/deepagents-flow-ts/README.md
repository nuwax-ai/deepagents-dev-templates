# deepagents-flow-ts

**通用工作流编排模板** —— Agent 按"设计好的节点连线规则(node + edge)"作为 LangGraph 工作流运行，
而不是自由的 tool loop。

与 [`deepagents-app-ts`](../deepagents-app-ts)（Coding Agent，agent loop 范式）互补：
本包复用它的 `runtime` 核心（config / model / logger / 存储），只把"大脑"换成一张显式图。

## 默认图（ReAct 式骨架，演示框架常用能力）

开箱即用的默认图是一个**通用 ReAct 式工作流**，每个节点演示一种常用编排模式，方便照着写：

```
START → prepare → think → act → observe → reflect ─(条件边)─┐
                       ▲                                  ├─ continue & 未达上限 → think（下一轮）
                       └──────────────────────────────────┘
                                                 └─ 否则 → respond → END
```

| 节点 | 演示的模式 | 文件 |
|---|---|---|
| `prepare` | 纯逻辑节点 + state 初始化 | [nodes/prepare.ts](src/app/nodes/prepare.ts) |
| `think` | LLM 节点 + 结构化输出 + 无凭证 fallback | [nodes/think.ts](src/app/nodes/think.ts) |
| `act` | 工具调用节点 + `onToolCall` 透出 | [nodes/act.ts](src/app/nodes/act.ts) |
| `observe` | state 转换 / 累积 | [nodes/observe.ts](src/app/nodes/observe.ts) |
| `reflect` | 条件边 + 循环 + 上限（编排核心） | [nodes/reflect.ts](src/app/nodes/reflect.ts) |
| `respond` | 流式输出（onToken） | [nodes/respond.ts](src/app/nodes/respond.ts) |

内置 demo 工具（`echo` / `calculate` / `time`）让 `act` 不依赖 MCP 即可演示工具调用；无模型凭证时 LLM 节点走启发式 fallback，图始终可跑、可测。

**少用 / 进阶模式**（并行 fan-out、人工介入 `interrupt`、`Command` 动态路由、子图、checkpointer 持久化）见 [docs/flow-patterns.md](docs/flow-patterns.md)。

## 示例：不同需求 → 不同拓扑

模板支持**两类 flow**：`FlowExecutor`（one-shot，单输入单输出）与 `StatefulFlow`（支持
human-in-the-loop，可 `interrupt` 暂停→等用户→`resume`）。下面四个示例覆盖常见编排拓扑，照着挑一个改：

| 示例 | 需求类型 | 拓扑 | LangGraph 特性 | seam |
|---|---|---|---|---|
| [examples/rag](examples/rag/) | 检索增强问答 | 线性 + 条件重试 | `addConditionalEdges` 重试 | one-shot |
| [examples/travel-planner](examples/travel-planner/) | 并行调研聚合 | 并行 map-reduce + HITL | `Send` 扇出 + reducer + 真实搜索 MCP | stateful |
| [examples/project-manager](examples/project-manager/) | 分解-评估-审批 | 评估循环 + HITL | reflection 回边 + 条件边 | stateful |
| [examples/human-in-loop](examples/human-in-loop/) | 生成→人审→定稿 | 线性 + 中途暂停 | `interrupt` + `Command(resume)` | stateful |

每个示例都**不重写** surface plumbing：写自己的图 + 节点 → 包成 `FlowExecutor`/`StatefulFlow` →
插进同一套 `bootstrapFlowAcp`/`runFlowCli`。

示例**真实接入**业务依赖（travel 用免 key 的 DuckDuckGo 搜索 MCP，其余 LLM 节点真调大模型），
**无 demo fallback——未配凭证直接报错**；运行前在 `.env` 配模型凭证（见下）。各示例的图拓扑 / 路由
仍抽成纯函数单测（`gather`/`fanout`/`routeAfterEvaluate`/`isApproval`），无凭证恒跑；真实接入用例 `skipIf` 无凭证自动跳过。

> 这与**默认 flow**（`src/app`，内置 demo 工具 + 无凭证启发式 fallback、始终可跑）取向不同：默认 flow 重「开箱即跑」，示例重「贴近真实业务」。

## 运行

```bash
# 先构建依赖的 runtime 核心
pnpm --filter deepagents-app-ts build

# 默认 flow：CLI
pnpm --filter deepagents-flow-ts flow "随便说点什么"
pnpm --filter deepagents-flow-ts exec tsx src/index.ts flow -i

# 默认 flow：ACP 服务（供 nuwaclaw/Zed/JetBrains）
pnpm --filter deepagents-flow-ts build && node packages/deepagents-flow-ts/dist/index.js

# 跑 RAG 范例（CLI）
pnpm --filter deepagents-flow-ts example:rag:cli "什么是 LangGraph？"

# 其它范例（CLI；travel/pm/review 会在中途暂停等你输入确认/审阅）
pnpm --filter deepagents-flow-ts example:travel "东京 3 天 美食优先"
pnpm --filter deepagents-flow-ts example:pm "做一个落地页"
pnpm --filter deepagents-flow-ts example:review "写一段产品介绍"
```

模型凭证见 [`.env.example`](.env.example)（ACP 模式下通常由 IDE host 注入）。

## 调试

默认 flow 和 RAG 范例各有调试入口（凭证放 `./.env` 或 shell）：

| 目标 | 命令 |
|---|---|
| 默认 flow CLI | `pnpm flow "..."` / `pnpm exec tsx src/index.ts flow -i` |
| 导出图拓扑 | `pnpm graph`（JSON）/ `pnpm graph --mermaid`（Mermaid 源） |
| 默认 flow ACP 冒烟（rcoder） | `pnpm smoke:acp` |
| RAG 范例 CLI | `pnpm example:rag:cli "..."` / `pnpm example:rag:interactive` |
| travel/pm/review 范例 CLI | `pnpm example:travel "..."` / `example:pm "..."` / `example:review "..."`（中途暂停等输入；加 `-i` 交互） |
| RAG 范例 ACP 冒烟（rcoder） | `pnpm smoke:rag` |
| 类型检查 | `pnpm typecheck`（src）/ `pnpm typecheck:examples`（examples + src，noEmit） |

`smoke:acp` / `smoke:rag` / `smoke:travel` / `smoke:pm` / `smoke:review` 用 rcoder-cli 端到端驱动 ACP
（握手 → `onPrompt` → 整图 → 流式答案）；`scripts/smoke-acp.sh` 的 `AGENT_ENTRY` 可指向任意 flow 入口。
**在 Zed 里 chat 调试**全部 5 个入口的 `agent_servers` 配置 + HITL 两轮玩法见 [docs/zed-debug.md](docs/zed-debug.md)。

## 怎么搭你自己的 flow

两种方式：

1. **直接改默认图**：编辑 [src/app/graph.ts](src/app/graph.ts) 的连线 + [src/app/nodes/](src/app/nodes/) 的节点逻辑。
2. **照 examples/ 的样子另起一个**：写自己的 graph + nodes，包成 `FlowExecutor` 或 `StatefulFlow`，插进 surface。

**两类 flow**（[src/surfaces/flow-types.ts](src/surfaces/flow-types.ts)）：
- `FlowExecutor`：one-shot，`(query, cb) => Promise<FlowResult>`。适合问答 / 检索 / 批处理（见 examples/rag）。
- `StatefulFlow`：支持 human-in-the-loop，`run({query|resume}, threadId, cb) => {done|interrupted}`。图里
  `interrupt` 暂停 → surface 把问题发给用户 → 下一轮 `resume`（见 examples/{travel-planner,project-manager,human-in-loop}）。
  机制：`MemorySaver` checkpointer + `Command({resume})`，thread_id = ACP sessionId。

**关键 seam**：surface 与具体图解耦。[src/surfaces/acp/server.ts](src/surfaces/acp/server.ts) 的 `bootstrapFlowAcp`
和 [src/surfaces/cli/run.ts](src/surfaces/cli/run.ts) 的 `runFlowCli` 按 `typeof executor` 自动分流两类 flow。
ACP 路径用 deepagents-acp 的 `onPrompt` 钩子跑 executor、经 `conn` 流式回传、返回 `{ stopReason }`
**短路 deep agent**——所以不需要 force-tool / 巨型提示词那套把 loop 逼成 workflow 的 hack。

## 导出图拓扑（可视化对接）

显式 StateGraph 的好处之一：节点连线是**静态可提取**的。`./topology` 把编译图反射成结构化数据
（不运行图、不需要凭证），供 inspector / 文档 / 调试器消费：

```bash
pnpm graph              # → { nodes, edges } JSON
pnpm graph --mermaid    # → Mermaid 源，可直接渲染
```

```ts
import { getFlowTopology } from "deepagents-flow-ts/topology";
const { nodes, edges, mermaid } = await getFlowTopology();
```

`edges[].conditional` 标出条件边（如 `reflect → think|respond`），数据来自 `getGraphAsync()`，
与 [src/app/graph.ts](src/app/graph.ts) 的真实连线**永不漂移**。导出逻辑见 [src/app/topology.ts](src/app/topology.ts)。

## 配置

[config/flow-agent.config.json](config/flow-agent.config.json)：标准 `agent` / `model` 段（走 `loadFlowConfig`）。
自定义块可加在顶层、用 `loadFlowConfig().raw` 取出（RAG 范例就是这么放 `rag` 段的）。
默认模型与 `deepagents-app-ts` 对齐（`anthropic / claude-sonnet-4-6`）；改 OpenAI 兼容端点见 `.env.example`。

## 测试

```bash
pnpm --filter deepagents-flow-ts test
```

- `tests/` — 默认图（条件边决策表 + 收敛）、纯函数（safeCalc 注入边界等）、图拓扑导出
- `examples/*/tests/` — 四个范例：RAG 重试、travel 并行+HITL、pm 评估循环+HITL、review 人审闭环
