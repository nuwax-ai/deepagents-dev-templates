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

## 完整范例

想看有真实节点逻辑的完整流程？见 **[examples/rag/](examples/rag/)** —— 一个 RAG（检索增强问答）工作流，
演示如何用本模板搭真实流程：自己写图+节点 → 包装成 `FlowExecutor` → 插进同一套 surface。

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
```

模型凭证见 [`.env.example`](.env.example)（ACP 模式下通常由 IDE host 注入）。

## 调试

默认 flow 和 RAG 范例各有调试入口（凭证放 `./.env` 或 shell）：

| 目标 | 命令 |
|---|---|
| 默认 flow CLI | `pnpm flow "..."` / `pnpm exec tsx src/index.ts flow -i` |
| 默认 flow ACP 冒烟（rcoder） | `pnpm smoke:acp` |
| RAG 范例 CLI | `pnpm example:rag:cli "..."` / `pnpm example:rag:interactive` |
| RAG 范例 ACP 冒烟（rcoder） | `pnpm smoke:rag` |
| 类型检查 | `pnpm typecheck`（src）/ `pnpm typecheck:examples`（examples + src，noEmit） |

`smoke:acp` / `smoke:rag` 用 rcoder-cli 端到端驱动 ACP（握手 → `onPrompt` → 整图 → 流式答案）；
`scripts/smoke-acp.sh` 的 `AGENT_ENTRY` 可指向任意 flow 入口。**在 Zed 里 chat 调试**（含 RAG 范例的
`agent_servers` 配置片段）见 [examples/rag/README.md](examples/rag/README.md) 的「调试」节。

## 怎么搭你自己的 flow

两种方式：

1. **直接改默认图**：编辑 [src/app/graph.ts](src/app/graph.ts) 的连线 + [src/app/nodes/](src/app/nodes/) 的节点逻辑。
2. **照 examples/rag 的样子另起一个**：写自己的 graph + nodes，包成 `FlowExecutor`，插进 surface。

**关键 seam**：surface 与具体图解耦。[src/surfaces/flow-types.ts](src/surfaces/flow-types.ts) 定义 `FlowExecutor`；
[src/surfaces/acp/server.ts](src/surfaces/acp/server.ts) 的 `bootstrapFlowAcp` 和
[src/surfaces/cli/run.ts](src/surfaces/cli/run.ts) 的 `runFlowCli` 接收任意 executor。
ACP 路径用 deepagents-acp 的 `onPrompt` 钩子跑 executor、经 `conn` 流式回传、返回 `{ stopReason }`
**短路 deep agent**——所以不需要 force-tool / 巨型提示词那套把 loop 逼成 workflow 的 hack。

## 配置

[config/flow-agent.config.json](config/flow-agent.config.json)：标准 `agent` / `model` 段（走 `loadFlowConfig`）。
自定义块可加在顶层、用 `loadFlowConfig().raw` 取出（RAG 范例就是这么放 `rag` 段的）。
默认模型与 `deepagents-app-ts` 对齐（`anthropic / claude-sonnet-4-6`）；改 OpenAI 兼容端点见 `.env.example`。

## 测试

```bash
pnpm --filter deepagents-flow-ts test
```

- `tests/flow.test.ts` — 默认占位图：条件边决策表 + 真实编译图收敛
- `examples/rag/tests/` — RAG 范例：条件重试集成 + 配置装配
