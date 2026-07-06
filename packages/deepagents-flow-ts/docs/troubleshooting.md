# 排错索引

> **范围**：本仓库（`deepagents-flow-ts` 工作目录）内 flow 的运行时排错。
> 先查 `.logs/`（`LOG_DIR=<REPO>/.logs`，`LOG_LEVEL=debug`；配置见 [zed-debug.md](zed-debug.md)）。
> **图编排硬规则**（按 ID 追加）：[flow-graph-rules.md](flow-graph-rules.md)。

## `LLM 未返回 JSON`

**规则**：**[R-G001](flow-graph-rules.md#r-g001-parse-仅当-write-消费-rparsed)**、**[R-G002](flow-graph-rules.md#r-g002-入口-llm-容忍非预期输入)**。

**症状**：日志或 ACP 报错 `LLM 未返回 JSON` / `LLM JSON 不完整`；图在某一 LLM 节点中断。

**常见根因**：`createLlmNode` 配置了 `parse: parseJson`，但 `write` **不读** `r.parsed`；用户输入非 prompt 预期格式（如打招呼、缺字段）时 LLM 回自然语言，`parseJson` 抛错。

**排查步骤**：

| 步 | 动作 |
|----|------|
| 1 | `.logs/` 搜 `LLM 未返回 JSON` 或节点 `label` |
| 2 | 打开 `src/app/flows/<name>/graph.ts` 对应 `addNode` |
| 3 | `write` 是否用 `r.parsed`？**否 → 删 `parse`** |
| 4 | 必须结构化？加强 prompt JSON schema；加 `fallback` 或 `createLlmRouterNode` + `routeFallback` |
| 5 | 入口节点？prompt 加非预期输入兜底（引导正确格式，不强求 JSON） |
| 6 | 手改过 `graph.ts`？**同步** `scripts/scaffold/specs/<name>.flow.json` |

**契约详表**：[flow-graph-rules.md](flow-graph-rules.md) R-G001 / R-G002。

**参考范例**：`scripts/scaffold/specs/_example.interview-agent.flow.json`（`prepare` 无 parse；`evaluate` 有 parse）。

---

## `Invalid edge`（条件边）

**规则**：[R-G004](flow-graph-rules.md#r-g004-条件边返回值--targets)。

**症状**：运行时 LangGraph 抛 `Invalid edge`。

**根因**：`addConditionalEdges` 的 `condition` 返回值 ∉ `targets`。

**注意**：`pnpm graph` 静态反射**不执行** condition，检不出此错——生成 custom 图时人工核对；见 [node-catalog.md § edge 约束](node-catalog.md#edge-约束custom-dsl)。

---

## 读日志六步（编排 / ACP / HITL）

图跑不通、节点未执行、条件边走错、HITL 不 resume、工具审批异常、ACP 无响应时：

| 步 | 动作 |
|----|------|
| 1 | 确认 env 含 `LOG_DIR`、`LOG_LEVEL`（HITL 建议 `debug`） |
| 2 | 复现：Zed / `pnpm smoke` / CLI |
| 3 | 打开 `.logs/` 最新 `.log` 或按 `sessionId` 定位 |
| 4 | 过滤：`runtime:flow-graph`、`interrupt`、`onPrompt`、`permission 门控` 等 |
| 5 | 修复后重跑，确认新日志无同类 error |
| 6 | 记录根因摘要（勿把整段 log 提交 git） |

常见前缀与 Zed 配置：[zed-debug.md](zed-debug.md)。

---

## HITL 不 resume / interrupt 无响应

- 确认 checkpointer 已配置（`createStatefulFlow` / stateful-recipe）
- `.logs/` 过滤 `interrupt` / `onPrompt`
- 按上文 [读日志六步](#读日志六步编排--acp--hitl)

---

## 工具 `Permission denied` / 客户端卡转圈

- `config/flow-agent.config.json` → `permissions.mode` / `interruptOn`（见 [capabilities.md](capabilities.md)）
- `.logs/` 过滤 `permission 门控` / `requestPermission`
- 按上文 [读日志六步](#读日志六步编排--acp--hitl)

---

## spec 与 graph.ts 不一致

**规则**：[R-G003](flow-graph-rules.md#r-g003-spec-与-graphts-双向同步)。

**症状**：手修 `graph.ts` 后 `generate.mjs` 覆盖修复；或 spec 仍含已删的 `parse`。

**规则**：`graph.ts` 与 `scripts/scaffold/specs/<name>.flow.json` **双向同步**；以当前可跑版本为准。

---

## 工具调用长时间 EXECUTING

**可能原因**：

1. 图在 LLM 节点抛错未走完，session 未正常收尾
2. 并行调试命令与 ACP 会话交叉

**建议**：先修图错误（尤其 `LLM 未返回 JSON`），再重跑 `pnpm smoke`。

---

## `task` / subagent（子智能体委派）

**症状**：`(subagent 无输出)`、子 agent 调 MCP 401、并行 `task` UI 混流。

**runtime 行为**（`deepagents-flow-ts` `task` 工具 + ACP）：

| 项 | 说明 |
|----|------|
| 默认工具集 | 无 `AGENT.md tools` 时继承父级工具（含平台聚合 MCP，不含 `task`） |
| 返回值 | `output` → 全量 AIMessage 扫描 → stream buffer 兜底 |
| 流式分桶 | `messageId=subagent:<name>:<toolCallId>` |
| 联网 | subagent 可直接调用当前会话已授权的搜索 MCP；`description` 仍须自包含 |
| Todo/Plan | 复杂任务调用 `write_todos`；并行 subagent 按父 `toolCallId` 聚合为 ACP `plan` 完整快照 |

**flow-builder 详表**：[dev-agent-flow Part 6](../../dev-agent-flow/skills/flow-builder/references/part6-subagent.md)

**维护者架构详表**：[development/subagent-task-and-acp-plan.md](../../../docs/packages/deepagents-flow-ts/development/subagent-task-and-acp-plan.md)

---

## 相关文档

- [flow-graph-rules.md](flow-graph-rules.md) — **图编排规则（R-G001+，可持续追加）**
- [node-kit.md](node-kit.md) — factory API + parse 契约摘要
- [node-catalog.md](node-catalog.md) — 选型决策树
- [flow-patterns.md](flow-patterns.md) — Send / interrupt / checkpoint
- [zed-debug.md](zed-debug.md) — 日志 env 配置
