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
| `rewrite` | 意图识别 + 查询重写 + 选检索源（[nodes/rewrite.ts](nodes/rewrite.ts)） |
| `retrieve` | 调检索源（示例用 MCP：context7 / howtocook）（[nodes/retrieve.ts](nodes/retrieve.ts)） |
| `grade_docs` + 条件边 | 编排核心：检索不足回 rewrite 重试，`MAX_RETRIEVE_ATTEMPTS` 封顶（[nodes/grade.ts](nodes/grade.ts)） |
| `prepare` | 合并/去重/排序/截断上下文（[nodes/prepare.ts](nodes/prepare.ts)） |
| `generate` | 基于上下文生成带 `[来源X]` 引用的回答（[nodes/generate.ts](nodes/generate.ts)） |

> 注意 LangGraph 限制：节点名不能与 state channel 同名。这里 channel 叫 `grade`，所以节点叫 `grade_docs`。

## 它如何复用模板

这正是模板的用法示范——示例**不重写** ACP/CLI plumbing，只：

1. 写自己的图 + 节点（[graph.ts](graph.ts)、[nodes/](nodes/)）
2. 包装成 `FlowExecutor`（[index.ts](index.ts)）
3. 插进包的 `bootstrapFlowAcp` / `runFlowCli`（surface 完全复用）

```ts
// index.ts 核心
const executor: FlowExecutor = async (query, { onToken }) => {
  const res = await executeRAG(query, { config, callbacks: onToken ? { onToken } : undefined });
  return { answer: res.answer, footer: formatSourcesFooter(res) };
};
await bootstrapFlowAcp({ executor, appConfig });   // 或 runFlowCli(executor, ...)
```

## 运行

```bash
# 先构建 runtime 依赖
pnpm --filter deepagents-app-ts build

# CLI 单次（需在 .env 或 host 提供模型凭证）
pnpm --filter deepagents-flow-ts example:rag:cli "什么是 LangGraph？"
# 交互
pnpm --filter deepagents-flow-ts example:rag:interactive
# ACP 服务
pnpm --filter deepagents-flow-ts example:rag
```

## 调试

重构后 RAG 搬进了 `examples/rag/`,默认入口(`src/index.ts`)跑的是占位 flow。调试
RAG 用下面这些入口(都在 `packages/deepagents-flow-ts` 内跑,凭证放 `./.env` 或 shell):

**CLI 单次**(最快看图执行):
```bash
pnpm example:rag:cli "什么是 LangGraph？"   # 或交互:pnpm example:rag:interactive
```

**rcoder-cli ACP 冒烟**(端到端:握手 → `onPrompt` → 整图 → 流式答案):
```bash
pnpm smoke:rag
# 等价于:AGENT_ENTRY=examples/rag/index.ts bash scripts/smoke-acp.sh
# 默认 prompt 用 SMOKE_PROMPT 覆盖;smoke:acp(默认 flow)的入口也可经 AGENT_ENTRY 切换
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
