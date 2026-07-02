# 示例：RAG 工作流

一个用 `deepagents-flow-ts` 模板搭出来的**完整、可运行**的工作流——检索增强问答（RAG）。
它是给 AI Agent 开发的**参考与指南**：展示如何把自己的节点接进模板的 surface。

## 图

```
START → rewrite → retrieve → grade_docs ─(条件边)─┐
                     ▲                            ├─ 检索不足 & 未达上限 → rewrite（重试）
                     └────────────────────────────┘
                                  └─ 否则 → prepare → generate → END
```

| 节点 | 职责 |
|---|---|
| `rewrite` | 意图识别 + 查询重写 + 选检索源（[rewrite.ts](../../src/libs/topologies/rag/nodes/rewrite.ts)） |
| `retrieve` | 调平台登记并经 ACP 注入的 MCP 检索源（[retrieve.ts](../../src/libs/topologies/rag/nodes/retrieve.ts)） |
| `grade_docs` + 条件边 | 检索不足回 rewrite 重试，`MAX_RETRIEVE_ATTEMPTS` 封顶（[grade.ts](../../src/libs/topologies/rag/nodes/grade.ts)） |
| `prepare` | 合并/去重/排序/截断上下文（[prepare.ts](../../src/libs/topologies/rag/nodes/prepare.ts)） |
| `generate` | 基于上下文生成带来源引用的回答（[generate.ts](../../src/libs/topologies/rag/nodes/generate.ts)） |

> 注意 LangGraph 限制：节点名不能与 state channel 同名。这里 channel 叫 `grade`，所以节点叫 `grade_docs`。

## 它如何复用模板

图和节点的单一权威是 [`src/libs/topologies/rag`](../../src/libs/topologies/rag/)。
本示例**不复制图逻辑、不重写 ACP/CLI 接入**，只：

1. 加载 RAG 场景配置（[config.ts](config.ts)）
2. 把 canonical graph 包成 conversational `StatefulFlow`（[flow.ts](flow.ts)）
3. 插进 `bootstrapFlowAcp` / `runFlowCli`（[index.ts](index.ts)）

```ts
const loaded = loadRagConfig();
const flow = createRagFlow(loaded);
await bootstrapFlowAcp({ executor: flow, appConfig: loaded.appConfig });
```

## 运行

```bash
# CLI 单次（需在 .env 或 host 提供模型凭证）
pnpm --filter deepagents-flow-ts example rag "什么是 LangGraph？"
# 交互
pnpm --filter deepagents-flow-ts example rag -i
# ACP 服务
pnpm --filter deepagents-flow-ts example rag
```

## 调试

**CLI 单次**(最快看图执行):
```bash
pnpm example rag "什么是 LangGraph？"   # 或交互: pnpm example rag -i
```

**rcoder-cli ACP 冒烟**(端到端:握手 → `onPrompt` → 整图 → 流式答案):
```bash
pnpm smoke -- --example rag
# 默认 prompt 用 SMOKE_PROMPT 覆盖; 默认 flow 用 pnpm smoke; 也可经 --entry 或 AGENT_ENTRY 切换
```

**Zed 聊天调试**:把下面这段贴进 Zed settings 的 `agent_servers`(对齐最早的
`rag-agent` server,入口换成示例):
```jsonc
"flow-rag-example": {
  "type": "custom",
  "command": "tsx",
  "args": ["<repo>/packages/deepagents-flow-ts/examples/rag/index.ts"],
  "env": {
    "OPENAI_API_KEY": "...",      // 或 ANTHROPIC_API_KEY
    "OPENAI_BASE_URL": "...",
    "OPENAI_MODEL": "...",
    "LOG_DIR": "<repo>/logs"
  }
}
```

**类型检查 / IDE**:`examples/` 不在根 tsconfig(`rootDir:src`)内,单独用
`tsconfig.examples.json` 覆盖——
```bash
pnpm typecheck:examples   # 类型检查 examples/ + src/(noEmit,不进 dist)
```
TS server 会自动发现它,`examples/rag/` 的 hover / go-to-def / 类型报错恢复。

## 配置

[config/rag-agent.config.json](config/rag-agent.config.json)：标准 `agent`/`model` 段（走模板的 `loadFlowConfig`）+ 顶层 `rag` 段（检索源/节点参数，由 [config.ts](config.ts) 取出）。

## 测试

`pnpm --filter deepagents-flow-ts test` 会一并跑本示例的测试（[tests/](tests/)）：
- `grade.test.ts` — 条件边决策表
- `graph.test.ts` — 真实编译图集成（不足重试一次后收敛 / 足够不重试且带来源）
- `config.test.ts` — 配置装配冒烟
