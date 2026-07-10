# Flow 图编排规则（Flow Graph Rules）

> **单一权威**：凡「图怎么写才对 / 常见坑怎么避」的硬性约定，**优先落本文件**，按规则 ID 追加。
> **范围**：仅适用于本工作目录内的 `graph.ts` / `*.flow.json` 开发与验证。
> 其他**本包**文档（[node-kit](node-kit.md)、[troubleshooting](troubleshooting.md)、[node-catalog](node-catalog.md) 等）只摘要 + 链到对应规则，避免多处漂移。
>
> **受众**：在本仓库内维护 `graph.ts`、`*.flow.json` 或运行验证的读者。

---

## 规则索引

| ID | 标题 | 级别 | 适用面 | 典型症状 |
|----|------|------|--------|----------|
| [R-G001](#r-g001-parse-仅当-write-消费-rparsed) | parse 仅当 write 消费 `r.parsed` | **MUST** | `createLlmNode` / custom `llm` | `LLM 未返回 JSON` |
| [R-G002](#r-g002-入口-llm-容忍非预期输入) | 入口 LLM 容忍非预期输入 | **SHOULD** | `__start__` 后第一个 `llm` | 打招呼 / 缺字段即崩 |
| [R-G003](#r-g003-spec-与-graphts-双向同步) | spec 与 graph.ts 双向同步 | **MUST** | custom scaffold | regenerate 覆盖手修 |
| [R-G004](#r-g004-条件边返回值--targets) | 条件边返回值 ∈ targets | **MUST** | `addConditionalEdges` | `Invalid edge` |
| [R-G005](#r-g005-send-并行写-reducer) | Send 并行写 reducer | **MUST** | `createFanout` / `Send` | 并发写覆盖 / InvalidUpdateError |
| [R-G006](#r-g006-llm-router-须有-routefallback) | llm-router 须有 routeFallback | **MUST** | `createLlmRouterNode` | parse/无模型时死循环 |
| [R-G007](#r-g007-节点名--state-channel-名) | 节点名 ≠ state channel 名 | **MUST** | 全图 | 状态读写混乱 |
| [R-G008](#r-g008-节点返回-partial-禁止-mutate) | 节点返回 Partial，禁止 mutate | **MUST** | 全图 | 不可预测状态 |
| [R-G009](#r-g009-流式-llm-write-须用-rtext) | 流式 LLM write 须用 `r.text` | **MUST** | `llm-stream` / `approval-finalize.rejectedLlm` | 无流式 / 修订输出为空 |

**级别**：`MUST` = 违反即 bug 或运行时错误；`SHOULD` = 强烈建议，违反易在边界输入下失败。

---

## 新增规则（扩展本表时）

复制下方模板，追加到「规则正文」末尾，并更新上表索引。ID 格式：`R-G###`（三位递增）。

```markdown
## R-G0XX：<简短标题>

| 项 | 内容 |
|----|------|
| **级别** | MUST / SHOULD |
| **适用** | … |
| **规则** | … |
| **原因** | … |
| **反例** | … |
| **正例** | … |
| **验证** | 命令 / 日志 / 人工核对 |
| **关联** | 文档 / 示例路径 |
```

---

## 规则正文

### R-G001：parse 仅当 write 消费 `r.parsed`

| 项 | 内容 |
|----|------|
| **级别** | **MUST** |
| **适用** | `createLlmNode`；custom spec 中 `type: "llm"` 且带 `"parse"` |
| **规则** | 配置了 `parse`（常用 `parseJson`）时，`write` **必须**读取 `r.parsed` 并用于 state 更新。`write` 只用 `r.content` → **禁止** `parse`。 |
| **原因** | `parseJson` 在 LLM 未输出 JSON 时抛 `LLM 未返回 JSON`；无 parsed 消费的节点不需要结构化解析。 |
| **反例** | `write: (_r) => ({ phase: "questioning" })` + `parse: (t) => parseJson(t)` |
| **正例** | `write: (r) => ({ phase: "questioning" })` 无 parse；或 `write` 读 `r.parsed` 且配 parse |
| **验证** | custom spec：`generate.mjs` 生成前静态检 R-G001；`write` 含 `r.parsed` 或解构 `parsed` 才允许 `"parse"`；跑通非「快乐路径」输入（如打招呼） |
| **关联** | [node-kit § parse 契约](node-kit.md)；[troubleshooting § LLM 未返回 JSON](troubleshooting.md)；`_example.interview-agent.flow.json` |

---

### R-G002：入口 LLM 容忍非预期输入

| 项 | 内容 |
|----|------|
| **级别** | **SHOULD** |
| **适用** | 从 `__start__` 进入的第一个 `llm` 节点（节点名常为 `prepare`/`compose`/`gather`，与 `type: prepare` 的 `createPrepareNode` 无关） |
| **规则** | 入口 LLM 的 `prompt` 应处理：打招呼、缺字段、格式错误 → 友好引导，**默认不强求 JSON**（除非 R-G001 要求且 write 消费 parsed）。 |
| **原因** | 用户首条消息常非业务「标准输入」；入口即 `parseJson` 最易触发 R-G001 类故障。 |
| **反例** | 首节点 prompt：「只输出 JSON {focusAreas:...}」且 write 不读 parsed |
| **正例** | 「若是 JD+简历则分析；否则自我介绍并引导用户提供 JD+简历；自然语言即可」 |
| **验证** | 手测首条输入「你好」「你是？」 |
| **关联** | [node-kit § parse 契约](node-kit.md#parse-使用契约必读)；`prompts/flow.base.md`（系统级提示词） |

---

### R-G003：spec 与 graph.ts 双向同步

| 项 | 内容 |
|----|------|
| **级别** | **MUST** |
| **适用** | `topology: "custom"`；`scripts/scaffold/specs/<name>.flow.json` 与 `src/app/flows/<name>/graph.ts` |
| **规则** | 手改 `graph.ts` 后 **必须**回写同名 `*.flow.json`；反之从 spec 重新 `generate.mjs` 会覆盖手修。以**当前可跑版本**为真相源，两处保持一致。 |
| **原因** | 曾出现 graph 已删 `parse`、spec 仍含 `parse` → 再生成即复发 bug。 |
| **反例** | 只改 `graph.ts` 修 `prepare`，未改 `interview-agent.flow.json` |
| **正例** | 修 graph 后同步 spec 中对应 `nodes.*.params` |
| **验证** | `diff` spec 与 graph 中节点 `parse`/`prompt`/`write` 一致 |
| **关联** | [node-kit § 节点级 scaffold](node-kit.md#节点级-scaffoldcustom-topology)；[scripts/README.md](../scripts/README.md)；`scripts/scaffold/generate.mjs` |

---

### R-G004：条件边返回值 ∈ targets

| 项 | 内容 |
|----|------|
| **级别** | **MUST** |
| **适用** | `addConditionalEdges(from, condition, targets)`；custom spec `kind: "conditional"` |
| **规则** | `condition(state)` 的返回值必须属于该边的 `targets` 列表（含映射里的 `__end__` → `END`）。 |
| **原因** | 否则运行时 LangGraph 抛 `Invalid edge`；`pnpm graph` **不执行** condition，静态检不出。 |
| **反例** | `condition` 返回 `"report"`，targets 只有 `["ask", "generate-report"]` |
| **正例** | 返回值与 targets 键名逐字一致；生成后人工核对 |
| **验证** | 对照 graph.ts 条件函数与 targets；generate 时看 CLI 提醒 |
| **关联** | [node-catalog § edge 约束](node-catalog.md) |

---

### R-G005：Send 并行写 reducer

| 项 | 内容 |
|----|------|
| **级别** | **MUST** |
| **适用** | `createFanout` / `Send` 扇出后多实例写同一 channel |
| **规则** | 被并行写入的 state channel **必须**配置 reducer（如 `string-array-append` / `(a,b) => [...a,...b]`）。 |
| **原因** | 无 reducer 的 LastValue 通道并发写会 `InvalidUpdateError` 或互相覆盖。 |
| **反例** | `findings: Annotation<string>()` + Send×N 同写 `findings` |
| **正例** | `findings: Annotation<T[]>({ reducer: (a,b) => [...a,...b], default: () => [] })` |
| **验证** | 并行路径集成测 |
| **关联** | [flow-patterns.md § Send](flow-patterns.md) |

---

### R-G006：llm-router 须有 routeFallback

| 项 | 内容 |
|----|------|
| **级别** | **MUST** |
| **适用** | `createLlmRouterNode` |
| **规则** | 必须提供 `routeFallback`（无模型 / 调用失败 / **parse 失败** → 放行或安全分支），防 reflection 死循环。 |
| **原因** | router 依赖结构化 `parse`；无 fallback 时一次 parse 失败即抛错或卡死。 |
| **反例** | 只有 `route` + `parse`，无 `routeFallback` |
| **正例** | `routeFallback: (s) => ({ goto: "__end__", update: { verdict: "pass" } })` |
| **验证** | 无凭证 / 故意坏 JSON 输入 |
| **关联** | [node-kit § createLlmRouterNode](node-kit.md) |

---

### R-G007：节点名 ≠ state channel 名

| 项 | 内容 |
|----|------|
| **级别** | **MUST** |
| **适用** | 全图 `addNode` 名与 `Annotation.Root` 字段 |
| **规则** | 图节点名（如 `"prepare"`、`"think"`）不得与 state channel 同名混淆语义；channel 是数据，节点是步骤。 |
| **原因** | 同名增加读写歧义，反射与日志难排查。 |
| **反例** | 节点 `"draft"` 且 channel `draft`，边与日志混谈「draft 节点」与「draft 字段」 |
| **正例** | 节点 `compose` 写 channel `draft` |
| **验证** | custom spec：`generate.mjs` 生成前静态检；`pnpm graph` 对照 |
| **关联** | [node-catalog.md](node-catalog.md)；[node-kit.md](node-kit.md) |

---

### R-G008：节点返回 Partial，禁止 mutate

| 项 | 内容 |
|----|------|
| **级别** | **MUST** |
| **适用** | 所有节点函数 |
| **规则** | 节点返回 `Partial<State>` 更新；**禁止** `mutate` 入参 `state` 对象。 |
| **原因** | LangGraph 以返回的 partial 合并状态；原地修改破坏可复现性与 checkpoint。 |
| **反例** | `state.items.push(x); return {}` |
| **正例** | `return { items: [x] }`（append channel 用 reducer） |
| **验证** | 代码审阅 |
| **关联** | [flow-patterns.md](flow-patterns.md)；[node-kit.md](node-kit.md) |

---

### R-G009：流式 LLM write 须用 `r.text`

| 项 | 内容 |
|----|------|
| **级别** | **MUST** |
| **适用** | custom `llm-stream`；`approval-finalize` 的 `rejectedLlm`（内部 `createLlmStreamNode`） |
| **规则** | `write` 必须读取 `r.text`（及可选 `r.streamed`），**不得**使用 `r.content`；`rejectedLlm` 不支持 `parse`。 |
| **原因** | `createLlmStreamNode` 写回 `{ text, streamed }`；spec 若仍写 `r.content` → regenerate 后修订路径输出 `undefined`，且主路径无逐 token。 |
| **反例** | `type: "llm-stream"` 但 `write: (r) => ({ output: r.content })` |
| **正例** | `write: (r) => ({ draft: r.text.trim() })`；finalize `rejectedLlm.write` 用 `r.text` |
| **验证** | `generate.mjs` 生成前静态检 R-G009（`lint-graph-rules.mjs`） |
| **关联** | [node-kit § createLlmStreamNode](node-kit.md#createllmstreamnode--流式-llm)；[README § 流式输出检查清单](../README.md#流式输出检查清单) |

---

## 与开发流程的衔接

| 阶段 | 动作 |
|------|------|
| 写 spec / graph 前 | 扫规则索引，确认适用 MUST |
| scaffold 生成后 | 核对 R-G001、R-G003、R-G004、R-G009 |
| 验证闸门 | 收工 `pnpm typecheck && pnpm test && pnpm exec tsx src/index.ts graph`（`config.flow.active`）；迭代期**不要** `pnpm build` |
| 排错 | [troubleshooting.md](troubleshooting.md) 按症状 → 规则 ID |

## 相关文档

- [node-catalog.md](node-catalog.md) — 选型
- [node-kit.md](node-kit.md) — factory API
- [troubleshooting.md](troubleshooting.md) — 症状 → 步骤
- [flow-patterns.md](flow-patterns.md) — Send / interrupt / checkpoint
- [scripts/README.md](../scripts/README.md) — scaffold / 真实调试命令
