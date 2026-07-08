# 示例：RAG 工作流

一个用 **nuwax-flow-ts** 工作流编排模板搭出来的**完整、可运行**示例——检索增强问答（RAG）。
展示如何把 canonical 拓扑接进模板的 ACP / CLI surface，而不复制图逻辑。

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
| `retrieve` | 调 MCP 检索源（[retrieve.ts](../../src/libs/topologies/rag/nodes/retrieve.ts)）；示例默认 `howtocook-mcp`（见 [config/rag-agent.config.json](config/rag-agent.config.json)），可换平台登记并经会话注入的检索工具 |
| `grade_docs` + 条件边 | 检索不足回 rewrite 重试，`MAX_RETRIEVE_ATTEMPTS` 封顶（[grade.ts](../../src/libs/topologies/rag/nodes/grade.ts)） |
| `prepare` | 合并/去重/排序/截断上下文（[prepare.ts](../../src/libs/topologies/rag/nodes/prepare.ts)） |
| `generate` | 基于上下文生成带来源引用的回答（[generate.ts](../../src/libs/topologies/rag/nodes/generate.ts)） |

> 注意 LangGraph 限制：节点名不能与 state channel 同名。这里 channel 叫 `grade`，所以节点叫 `grade_docs`。

## 它如何复用模板

图和节点的单一权威是 [`src/libs/topologies/rag`](../../src/libs/topologies/rag)。
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

在**包根目录**下执行（相对本文件为 `../..`）：

```bash
# CLI 单次（需在 .env 或 host 提供模型凭证）
pnpm example rag "什么是 LangGraph？"
# 交互
pnpm example rag -i
# ACP 服务
pnpm example rag
```

## 调试

**CLI 单次**（最快看图执行）：见上文 [运行](#运行)。

**ACP 冒烟**（握手 → `onPrompt` → 整图 → 流式答案）：

```bash
pnpm smoke -- --example rag
# 默认 prompt 可用 SMOKE_PROMPT 覆盖
```

**Zed 聊天调试**：把下面贴进 Zed settings 的 `agent_servers`：

```jsonc
"flow-rag-example": {
  "type": "custom",
  "command": "tsx",
  "args": ["<REPO>/examples/rag/index.ts"],
  "env": {
    "OPENAI_API_KEY": "...",      // 或 ANTHROPIC_API_KEY
    "OPENAI_BASE_URL": "...",
    "OPENAI_MODEL": "...",
    "LOG_LEVEL": "debug",
    "LOG_DIR": "<REPO>/.logs"
  }
}
```

**类型检查 / IDE**：`examples/` 不在根 tsconfig（`rootDir: src`）内，单独用 `tsconfig.examples.json`：

```bash
pnpm typecheck:examples   # 类型检查 examples/ + src（noEmit，不进 dist）
```

## 配置

[config/rag-agent.config.json](config/rag-agent.config.json)：标准 `agent` / `model` 段（走 `loadFlowConfig`）+ 顶层 `rag` 段（`retrievalTools`、`mcpServers`、各节点参数，由 [config.ts](config.ts) 取出）。

示例内置 `howtocook-mcp` 作为可跑的演示检索源；生产环境可改为平台登记的检索能力（禁止手写 fetch 包装）。

## 测试

```bash
pnpm test
```

会一并跑本示例的测试（[tests/](tests/)）：

- `grade.test.ts` — 条件边决策表
- `graph.test.ts` — 真实编译图集成（不足重试一次后收敛 / 足够不重试且带来源）
- `config.test.ts` — 配置装配冒烟
