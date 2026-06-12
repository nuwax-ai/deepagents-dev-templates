# deepagents-flow-ts

**工作流编排模板** —— Agent 按"设计好的节点连线规则(node + edge)"作为 LangGraph 工作流运行，
而不是自由的 tool loop。RAG 只是这里的第一个示例图。

与 [`deepagents-app-ts`](../deepagents-app-ts)（Coding Agent，agent loop 范式）互补：
本包复用它的 `runtime` 核心（config / model / logger / 存储），只替换"大脑"为一张显式图。

## 工作流图

```
START → rewrite → retrieve → grade_docs ─(条件边)─┐
                     ▲                            ├─ insufficient & 未达上限 → rewrite（重试）
                     └────────────────────────────┘
                                  └─ 否则 → prepare → generate → END
```

- **rewrite** — 意图识别 + 查询重写 + 选择检索源
- **retrieve** — 调用检索源（示例用 MCP：context7 / howtocook）
- **grade_docs** + **条件边** — 编排核心：检索不足则回到 rewrite 重试（`MAX_RETRIEVE_ATTEMPTS` 封顶防死循环），足够则放行
- **prepare** — 合并 / 去重 / 排序 / 截断上下文
- **generate** — 基于上下文生成带 `[来源X]` 引用的回答

节点与连线都是静态、可读、可被 inspector 抽取/可视化的结构。

## 运行

```bash
# 1) 先构建依赖的 runtime 核心
pnpm --filter deepagents-app-ts build

# 2) CLI 单次测试
pnpm --filter deepagents-flow-ts rag "什么是 LangGraph？"
pnpm --filter deepagents-flow-ts exec tsx src/index.ts rag --interactive

# 3) 作为 ACP 服务（供 nuwaclaw/Zed/JetBrains）
pnpm --filter deepagents-flow-ts build && node packages/deepagents-flow-ts/dist/index.js
```

模型凭证见 [`.env.example`](.env.example)（ACP 模式下通常由 IDE host 注入）。

## 改编排

想换流程？只改这两处，无需动 runtime：

- **图的连线**：[`src/app/graph.ts`](src/app/graph.ts) 的 `addNode` / `addEdge` / `addConditionalEdges`
- **节点逻辑**：[`src/app/nodes/`](src/app/nodes/)（`rewrite` / `retrieve` / `grade` / `prepare` / `generate`）

## 它如何接入 ACP

[`src/surfaces/acp/server.ts`](src/surfaces/acp/server.ts) 用 deepagents-acp 的 `onPrompt` 钩子：
收到 prompt → 跑工作流图 `executeRAG()` → 经 `conn` 流式回传 → 返回 `{ stopReason }` 短路。
deep agent 永不进入请求路径，因此不需要 force-tool / 巨型提示词等"把 loop 逼成 workflow"的 hack。

## 配置

[`config/rag-agent.config.json`](config/rag-agent.config.json)：单文件，含标准 `agent`/`model` 段
（交给 app-ts 的 `loadConfig`）+ 顶层 `rag` 段（图/检索配置）。默认模型与 `deepagents-app-ts`
一致（`anthropic / claude-sonnet-4-6`）；改用 OpenAI 兼容端点见 `.env.example` 注释。

## 测试

```bash
pnpm --filter deepagents-flow-ts test
```

- `tests/grade.test.ts` — 条件边决策表（纯函数）
- `tests/graph.test.ts` — 真实编译图集成：验证"不足重试一次后收敛"与"足够不重试且带来源"
- `tests/config.test.ts` — 随包配置装配冒烟
