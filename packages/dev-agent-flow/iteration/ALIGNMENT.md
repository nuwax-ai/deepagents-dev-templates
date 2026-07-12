# 功能与规则对齐基线

对照 [`../orchestration/`](../orchestration/) 与（按需）[`../../deepagents-flow-ts`](../../deepagents-flow-ts)。  
版本回朔见 [`VERSIONS.md`](VERSIONS.md)。

## 权威层级

| 层级 | 权威 |
|------|------|
| 可否报完成 | `orchestration/system-prompt.md` `<SESSION_CLOSE>` |
| 是否改图 | L0 + 目标项目 `docs/examples.md` + flow-builder Part 0 |
| 平台读写 / 登记 | `dev-engineer-toolkit` |
| 操作步骤 | flow-builder Part* |
| 收工证据 | `flow-debugger`（SSE + `.logs/`） |
| 图规则 / 术语 | 目标项目 `docs/` |

## 范围

- 主调优：`orchestration/`（人工同步开发 Agent 编排后台）
- 迭代：`iteration/`（不下发）
- 模板 `deepagents-flow-ts`：**默认不动**；对齐需要时可改并记 VERSIONS

## 如何确认迭代方向对

1. **对象**：改的是开发 Agent 编排配置，不是某个业务 Agent 的产品需求。  
2. **方向三问**（见 [`ITERATION.md`](ITERATION.md) 模板）：痛点？同步后立刻可用？可回朔？  
3. **目标句**：`开发者做 X 时，开发 Agent 应 Y，用 Z 验证` —— 写不出就先停。  
4. **证据**：`iteration:static` / drift = 契约没坏；真实会话抽测 = 方向打中。翻 [`VERSIONS.md`](VERSIONS.md) 若反复改同一口径，方向不稳。

## 已对齐项（iter-0.2.0）

- ask-question：对开发者 vs 目标 Agent 图内 HITL 拆清
- `download-skill`：L0 / Part 7 / toolkit §5 统一为「平台技能禁下载、只 add-tool」
- manifest `requiredSections` 含 `MCP_USAGE`
- 模板平台能力双路径表述已与 Part 3 一致（本轮未改模板文件）

## 已知张力（未改模板）

- 无（本轮）
