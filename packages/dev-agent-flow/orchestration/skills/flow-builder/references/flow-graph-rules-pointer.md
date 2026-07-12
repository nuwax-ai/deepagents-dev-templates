# Flow 图编排规则（索引）

> 所属：`flow-builder`（**开发 Agent 侧路由页**）。
> **单一权威在当前工作目录** `docs/flow-graph-rules.md`（规则 ID：`R-G001`…）。

## 何时读

- 写 / 改 `src/app/graph.ts`（或自建 flow 的 `src/app/flows/**/graph.ts`）
- 遇到 `LLM 未返回 JSON`、`Invalid edge`、节点名与 channel 冲突
- 术语歧义 → 当前工作目录 `docs/glossary.md`
- 新增约定 → 在目标项目 `docs/flow-graph-rules.md` 追加 `R-G0XX`（**不要**只改本页）

## 详表

**R-G001–R-G009 全文、正反例、验证方式** → 当前工作目录 **`docs/flow-graph-rules.md`**。

## 与其他 Part 的关系

| Part | 关系 |
|------|------|
| Part 1 | [part1-fixed-flow.md](part1-fixed-flow.md) 固定流程型图选型与落地（含 HITL 人审）；落地时人工核对 R-G001/R-G004/R-G007/R-G009 |
| Part 2 | 工厂用法；流式 → § 流式输出 + R-G009 |
| Part 3 | 平台能力登记 → `dev-engineer-toolkit` |
| Part 4 | completion gate + flow-debugger → `docs/troubleshooting.md` |
| Part 5 | 提示词；R-G002 入口 parse 约束 |
