# Flow 图编排规则（索引）

> 所属：`flow-builder`（**开发 Agent 侧路由页**）。
> **单一权威在当前工作目录** `docs/flow-graph-rules.md`（规则 ID：`R-G001`…）。

## 何时读

- 维护 / 排查默认图 `src/app/graph.ts`（默认 ReAct；不新建自建 flow）
- 遇到 `LLM 未返回 JSON`、`Invalid edge`、节点名与 channel 冲突
- 术语歧义 → 当前工作目录 `docs/glossary.md`
- 新增约定 → 在目标项目 `docs/flow-graph-rules.md` 追加 `R-G0XX`（**不要**只改本页）

## 详表

**R-G001–R-G009 全文、正反例、验证方式** → 当前工作目录 **`docs/flow-graph-rules.md`**。

## 与其他 Part 的关系

| Part | 关系 |
|------|------|
| Part 0 | 端到端流程；default ReAct 唯一落地路径 |
| Part 3 | 平台能力登记 → `dev-engineer-toolkit` |
| Part 4 | completion gate + flow-debugger → `docs/troubleshooting.md` |
| Part 5 | 提示词；R-G002 入口 parse 约束 |
