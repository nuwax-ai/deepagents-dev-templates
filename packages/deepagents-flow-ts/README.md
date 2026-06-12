# deepagents-flow-ts

**通用工作流编排模板** —— Agent 按"设计好的节点连线规则(node + edge)"作为 LangGraph 工作流运行，
而不是自由的 tool loop。

与 [`deepagents-app-ts`](../deepagents-app-ts)（Coding Agent，agent loop 范式）互补：
本包复用它的 `runtime` 核心（config / model / logger / 存储），只把"大脑"换成一张显式图。

## 默认图（占位骨架）

开箱即用的默认图是一个**极简占位 flow**，只为展示连线机制（`addNode` / `addEdge` / `addConditionalEdges`）：

```
START → prepare → act → decide ─(条件边)─┐
                   ▲                     ├─ retry & 未达上限 → act（再来一轮）
                   └─────────────────────┘
                                └─ 否则 → respond → END
```

节点逻辑是 trivial 占位（[src/app/nodes/](src/app/nodes/)），`decide` 占位恒返回 `retry` 以演示重试循环，
`MAX_ACT_ATTEMPTS` 封顶防死循环。**这是你的起手式**——把占位换成你自己的逻辑即可。

## 完整范例

想看有真实节点逻辑的完整流程？见 **[examples/rag/](examples/rag/)** —— 一个 RAG（检索增强问答）工作流，
演示如何用本模板搭真实流程：自己写图+节点 → 包装成 `FlowExecutor` → 插进同一套 surface。

## 运行

```bash
# 先构建依赖的 runtime 核心
pnpm --filter deepagents-app-ts build

# 默认 flow（占位）：CLI
pnpm --filter deepagents-flow-ts flow "随便说点什么"
pnpm --filter deepagents-flow-ts exec tsx src/index.ts flow -i

# 默认 flow：ACP 服务（供 nuwaclaw/Zed/JetBrains）
pnpm --filter deepagents-flow-ts build && node packages/deepagents-flow-ts/dist/index.js

# 跑 RAG 范例
pnpm --filter deepagents-flow-ts example:rag rag "什么是 LangGraph？"
```

模型凭证见 [`.env.example`](.env.example)（ACP 模式下通常由 IDE host 注入）。

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
