# Flow 图编排规则（索引）

> 所属：`flow-builder`（**开发 Agent 侧路由页**）。
> **单一权威在当前工作目录** `docs/flow-graph-rules.md`（规则 ID：`R-G001`…，可持续追加）。
> 当前工作目录文档只描述当前工作目录本身；开发 Agent 的工作流（何时读、如何验证）由本技能 Part 1–4 补充。

## 何时读

- 写 / 改 `src/app/flows/**/graph.ts` 或 `scripts/scaffold/specs/*.flow.json`
- 遇到 `LLM 未返回 JSON`、`Invalid edge`、regenerate 覆盖手修、节点名与 channel 冲突
- 术语歧义（durable stateful flow / recursion guard / completion gate 等）→ 当前工作目录 **`docs/glossary.md`**
- 新增一条「图编排约定」→ 在当前工作目录 `flow-graph-rules.md` § 新增规则模板 追加 `R-G0XX`（**不要**只改本路由页）

## 当前规则速览

| ID | 标题 | 级别 | 当前工作目录静态检 |
|----|------|------|----------------|
| R-G001 | parse 仅当 write 消费 `r.parsed` | MUST | `generate.mjs` → `lint-graph-rules.mjs` |
| R-G002 | 入口 LLM 容忍非预期输入 | SHOULD | 手测 / `SMOKE_PROMPT_EDGE`（见 part4b-smoke） |
| R-G003 | spec 与 graph.ts 双向同步 | MUST | 人工 diff；regenerate 会覆盖 |
| R-G004 | 条件边返回值 ∈ targets | MUST | `pnpm graph` **不**执行 condition |
| R-G005 | Send 并行写 reducer | MUST | 代码审阅 |
| R-G006 | llm-router 须有 routeFallback | MUST | 代码审阅 |
| R-G007 | 节点名 ≠ state channel 名 | MUST | `generate.mjs` → `lint-graph-rules.mjs` |
| R-G008 | 节点返回 Partial，禁止 mutate | MUST | 代码审阅 |
| R-G009 | 流式 LLM write 须用 `r.text` | MUST | `generate.mjs` → `lint-graph-rules.mjs` |

详表、正反例、验证方式 → 当前工作目录 **`docs/flow-graph-rules.md`**。

## 与其他 Part 的关系

| Part | 关系 |
|------|------|
| Part 1 scaffold | R-G003、**R-G009**；`generate.mjs` 生成前跑 R-G001/R-G007/R-G009 lint；流式范例 `_example.translate-review`、`_example.multi-aspect-search` |
| Part 2 编排 | 工厂用法；**流式输出**见 § 流式输出；硬规则以当前工作目录 R-G* 为准 |
| Part 3 工具 | 平台能力登记 → `dev-engineer-toolkit`；**平台能力登记**；**联网搜索**见 § 联网搜索；仓库内分层见当前工作目录 `docs/capabilities.md` |
| Part 4 验证 | completion gate 五连；症状 → 当前工作目录 `docs/troubleshooting.md` |
| Part 5 提示词 | R-G002；节点 `prompt` vs `systemPrompt`；禁止在入口乱加 `parseJson` |
