# Curated examples

本目录面向使用 **nuwax-flow-ts** 工作流编排模板的 AI Agent：少量、互补、可运行的 surface 接入范例。

## 使用边界

- **图逻辑单一权威**在 `src/libs/topologies/`；本目录只演示如何把 topology 包成
  `FlowExecutor` / `StatefulFlow`，再接入共用 ACP/CLI surface。
- 新业务优先用 `scripts/scaffold/` 生成到 `src/app/flows/`，不要复制或修改本目录。
- `graph.ts` 中的 re-export / 薄包装不是第二份实现；查节点和边时直接读对应 topology。

## 选择

| 示例 | 适用问题 | 单一权威 |
|---|---|---|
| `rag` | 检索、重写、质量评分与条件重试 | `src/libs/topologies/rag/` |
| `human-in-loop` | 用 ask-question MCP 展示审阅表单，再持久化暂停并等待人工定稿 | `src/libs/topologies/human-in-loop/` |
| `travel-planner` | `Send` 并行调研、reducer 聚合与确认门 | `src/libs/topologies/travel-planner/` |
| `project-manager` | evaluator-optimizer 重做循环与人工审批 | `src/libs/topologies/project-manager/` |
| `deep-research` | 多阶段、双层 reflection、并行调研与持续会话 | `src/libs/topologies/deep-research/` |

`dev-agent` 不设重复示例：它复用默认 ReAct 图，权威实现是
`src/app/topologies/dev-agent.ts`；subgraph factory 见 [docs/node-kit.md](../docs/node-kit.md)。

## 运行

在**包根目录**下执行（相对本目录为 `..`）：

```bash
pnpm example --list
pnpm example <name> [args]
```

各范例详情见子目录 `README.md`。类型检查：`pnpm typecheck:examples`。

Zed / 日志 env 见 [docs/zed-debug.md](../docs/zed-debug.md)（`<REPO>` = 包根目录绝对路径）。
