# 拓扑积木化重构 code-review 修复计划

> **日期**：2026-06-22 ｜ **分支**：`feat/topology-scaffold` ｜ **状态**：✅ 15/15 已落地并验证（typecheck + typecheck:examples + test 197 + graph 反射 + RAG streaming 端到端全绿，详见文末「执行结果」）
>
> `feat/topology-scaffold`（vs `main`，~8.5k 行 diff）做了 flow-ts 的拓扑积木化重构 + scaffold 蓝图 + 新节点原语。一次 max-effort code-review 发现 15 个真实缺陷，本计划逐项修复。
>
> **本文档已含一次方案评审修订**（见下方「评审修订摘要」）——15 项中 3 项（#10/#11/#15）的落地方式经核查后调整，另有数处措辞/框定纠正。

## Context（已对照真实实现核实）

关键事实（每条都重新读过源码，不止凭审查描述）：

- `attempts:1` = 不重试（`withRetry` 默认 3 次，[llm-resilience.ts:90](../../../../packages/deepagents-flow-ts/src/runtime/services/llm-resilience.ts)）；`undefined` = 默认 3。
- `parseJson` 失败**抛错**不返回 null（[llm.ts:43](../../../../packages/deepagents-flow-ts/src/libs/nodes/llm.ts)）；`createLlmNode` 的 `fallback` 仅在无模型/调用失败时触发，parse 成功但缺字段**不**触发 fallback。
- `resolveModel`（[model.ts:27](../../../../packages/deepagents-flow-ts/src/runtime/context/model.ts)）按 provider 解析 apiKey，空则构造**无 key 实例**不抛错；`cacheKey`（:28）**不含 apiKey** → 首次空 key 被永久缓存。
- `mcp-bridge.tool.ts:35` 把 `listMcpTools` 返回值直接 `JSON.stringify`，需要**含 schema 的原始响应**；libs 版 `listMcpTools` 返回 `string[]`（丢 schema），旧 `runtime/services/mcp-stdio.ts` 版返回原始 `unknown`（含 schema）。
- **reflect 实测**：`getGraphAsync` 利用 `addNode` 第三参 `{ends:[...]}` 把 Command goto 目标渲染成条件边。deep-research 4 个 router 节点全带 ends（[deep-research/graph.ts:182,193,211,213](../../../../packages/deepagents-flow-ts/src/libs/topologies/deep-research/graph.ts)）→ 全部边正确反射；router-gate 的 gate 没带 ends（[router-gate/graph.ts:38](../../../../packages/deepagents-flow-ts/src/app/flows/router-gate/graph.ts)）→ `gate→draft` 重做边丢失。**reflect.ts 无需改逻辑**，根源是 `custom.mjs` 生成 llm-router 节点时不渲染 ends。
- `runtime/services/mcp-stdio.ts`（旧，无 resolve/choose）与 `libs/mcp/stdio-client.ts`（新，完整）是两份平行实现；旧版**仅 `mcp-bridge.tool.ts` 一个引用方**（删除安全）。
- `flowType`（[schema.mjs:28](../../../../packages/deepagents-flow-ts/scripts/scaffold/schema.mjs)）**全仓零代码引用**——注册形态的 `kind` 来自 blueprint 导出的 `kind`（[generate.mjs:101](../../../../packages/deepagents-flow-ts/scripts/scaffold/generate.mjs)），与 flowType 无关；是 dead field。
- `tsconfig.json` 同时开 `noUnusedLocals` + `noUnusedParameters`（:18-19）。
- conventions 角度的「CLAUDE.md 规则」是 agent 虚构——该包无任何 CLAUDE.md，相关 4 项发现已作废，不在本计划。

## 评审修订摘要（落地前必读）

| 项 | 原方案 | 修订 |
|---|---|---|
| **#15** | 「整体替换为 `createLlmStreamNode`」当成干净替换 | RAG 的 onToken 经**显式 `callbacks` 参数**接线（[executor.ts:52](../../../../packages/deepagents-flow-ts/src/libs/topologies/rag/executor.ts)→[graph.ts:130](../../../../packages/deepagents-flow-ts/src/libs/topologies/rag/graph.ts)），而 factory 从 **`lgConfig.configurable.onToken`** 探测 sink（[llm.ts:84](../../../../packages/deepagents-flow-ts/src/libs/nodes/llm.ts)）。naive 替换会让 `hasVisibleTokenSink=false` → **静默丢 streaming**，typecheck/graph 都抓不到。**必须先把 onToken 接进 configurable**，并新增 streaming 端到端验收。 |
| **#10** | 同时改 generate.ts:42 与 rewrite.ts:73 | generate.ts 会被 **#15 整体重写**，#10 对它的改动会被覆盖 → **#10 实际只改 rewrite.ts**。且 rewrite 从「resolveModel→null→createLlmNode fallback 优雅降级」换成 requireModel 会**抛错**→被 graph.ts:190 catch→整个 RAG 返回错误提示：这是**去掉单节点优雅降级**的行为变更（方向可接受，与其余拓扑一致，但需明示）。 |
| **#11** | 无 parse → routeFallback | llm-router docstring（[llm-router.ts:41](../../../../packages/deepagents-flow-ts/src/libs/nodes/llm-router.ts)）明说「parse 缺省则 parsed=content 原文」——无 parse 的字符串路由是**设计特性**。加守卫会废掉它 → **必须同步把 docstring 改成「parse 必填」**，否则契约自相矛盾。优先级下调（当前全部调用方都给 parse，纯防御未来手写节点）。 |
| **#4** | 空 import 是「语法错误」 | `import {  } from "..."` 是**合法 TS**，即便开 noUnusedLocals 也不报错。#4 真正的修复只有**未用的 `appConfig` 形参**（noUnusedParameters 触发）；省略空 import 行降级为美化（且 all-passthrough spec 现实几乎不出现）。 |
| **#1** | 「不再静默放行」 | 删 attempts:1 恢复 3 次重试是对的，但 routeFallback **重试耗尽后仍 fail-open**（默认 sufficient/pass）。所以是「减少」而非「消除」静默放行——**重试后 fail-open 是刻意选择**（别让 flaky 评审卡死用户）。 |
| **#7** | 清 11 个 spec 的 flowType | 这些 zod object 非 strict，残留 flowType 键会被**静默忽略**不报错。删 schema 字段正确且安全；清 spec 只是整洁，非必需。 |

## Tier 1 — 纯 bug（8 项，低风险，改法明确）

### 1. review.ts 评审节点恢复重试
[review.ts:48,94](../../../../packages/deepagents-flow-ts/src/libs/topologies/deep-research/nodes/review.ts)：删掉两处 `attempts: 1`（让 `invokeWithResilience` 走默认 3 次）。瞬态 429/超时不再 1 次就 `routeFallback`。
> 注（评审）：routeFallback 在重试耗尽后**仍 fail-open**（默认 sufficient/pass）——这是刻意的「别让 flaky 评审卡死流水线」，本项只是把放行门槛从 1 次抬到 3 次。

### 2. 凭证可靠性（requireModel + cacheKey）
- [model.ts](../../../../packages/deepagents-flow-ts/src/runtime/context/model.ts)：抽 `export function resolveApiKey(config): string`（把现有 :34-48 的 provider-aware 解析提为独立导出），`resolveModel` 复用之；`cacheKey`（:28）追加 `` `|${resolveApiKey(config)}` ``，使 env 后置填充时重新构造实例。
- [model-resolver.ts:17-30](../../../../packages/deepagents-flow-ts/src/libs/nodes/model-resolver.ts)：`requireModel` 改为调 `resolveApiKey(appConfig)`，为空才抛错（替代当前「vars 任意一个存在」误判）。配置错配（provider=openai 却只设 ANTHROPIC_API_KEY）将正确抛错而非产出 401。

### 3. custom.mjs any-last 通道加 reducer
[custom.mjs](../../../../packages/deepagents-flow-ts/scripts/scaffold/blueprints/custom.mjs) `renderState`：`any-last` 单列一个分支 → `Annotation<unknown>({ reducer: (_a, b) => b })`（当前落到无 reducer 的 fallthrough，fanout 并发写会 `InvalidUpdateError`）。`any-last` 别名本就是「last-wins reducer」语义，这里是补回设计意图。现无 spec 使用 any-last，安全。

### 4. custom.mjs unused 参数（空 import 顺带美化）
[custom.mjs](../../../../packages/deepagents-flow-ts/scripts/scaffold/blueprints/custom.mjs)：
- **真修复**：`buildGraph(appConfig, …)`（render 模板 :189）——若无任何 `llm/llm-router/approval-finalize` 节点，`appConfig` 未被引用 → `noUnusedParameters` 报错。按 `collectImports` 是否含 `requireModel`（⟺ appConfig 是否被用）决定形参名加 `_` 前缀。
- **美化**：`imp.nodes` 为空时省略整条 `import { … } from "../../../libs/nodes/index.js"`（空 import 合法但冗余；触发条件是 all-passthrough spec，现实几乎不出现）。

### 5. chooseMcpToolName 收紧模糊匹配
[stdio-client.ts:182](../../../../packages/deepagents-flow-ts/src/libs/mcp/stdio-client.ts)：删除无条件 `/search/i.test(n)`（保留双向 `includes` 匹配），避免名字含 search 的无关工具被静默选中。
> 回归面（评审已核）：context7.ts 显式传 aliases（`resolve_library_id`/`query_docs`），不依赖 /search/；callResolvedMcpTool 默认 aliases 已含 `search`/`web_search`/`query`，exact「search」工具仍命中。低回归风险。

### 6. approval-finalize 透传 config
[approval-finalize.ts:44](../../../../packages/deepagents-flow-ts/src/libs/nodes/approval-finalize.ts)：节点签名改 `(state: S, config?: LangGraphRunnableConfig)`，`return rejected(state, config)`。让内部 `createLlmNode` 的 write 回调拿到 configurable（B.4 config 透传已落地于 [llm.ts:163,182](../../../../packages/deepagents-flow-ts/src/libs/nodes/llm.ts)，故本项有效非空操作）。

### 7. 删除 dead field flowType
- [schema.mjs:28](../../../../packages/deepagents-flow-ts/scripts/scaffold/schema.mjs)：从 `base` 移除 `flowType`。
- 清理全部 `_example.*.flow.json`（~11 个）的 `"flowType": …` 行（整洁，非必需——zod 非 strict 会忽略残留键）。
- generate.mjs 零引用，无需改。

### 8. grade-redo 健壮化（verdict 默认 + 重试计数）
[grade-redo/graph.ts](../../../../packages/deepagents-flow-ts/src/app/flows/grade-redo/graph.ts) + [_example.grade-redo.flow.json](../../../../packages/deepagents-flow-ts/scripts/scaffold/specs)：
- grade 的 write：`verdict` 未知（合法 JSON 缺/错键）→ 默认 `'fail'`（当前 `'pass'` 静默放行不合格草稿）。
- state 加 `attempts` 通道；grade 节点 write 递增 attempts；条件边 `verdict==='fail' && attempts < MAX → 'write'`，否则 END。给 custom blueprint 的 conditional + state 计数器示范自限制重试（当前靠 recursionLimit:6 兜底崩溃）。
> 注（评审）：grade 用 `parseJson` 且无 fallback，**非 JSON 响应会抛错崩流程**（在 verdict 默认值生效前）。本项修的是「合法 JSON 缺键」一路，非 JSON 崩溃路不在范围（可后续给 grade 加 fallback）。

## Tier 2 — 中等重构（3 项）

### 9. callResolvedMcpTool 复用子进程
[stdio-client.ts](../../../../packages/deepagents-flow-ts/src/libs/mcp/stdio-client.ts)：当前 `callResolvedMcpTool` 先 `resolveMcpToolName`（spawn→tools/list→kill）再 `callMcpTool`（spawn→tools/call→kill），每次逻辑检索 = 2 次冷启动。新增内部 `withStdioMcpSession(config, async (call) => { …list…; …call… })`，一个子进程内完成 initialize→list→call→kill。`callResolvedMcpTool` 与 `callMcpTool`/`listMcpTools` 改走它。

### 10. RAG rewrite 凭证统一（generate 归 #15）
[rewrite.ts:73](../../../../packages/deepagents-flow-ts/src/libs/topologies/rag/nodes/rewrite.ts)：`resolveModel(appConfig!)`（返回 null 触发 fallback）→ `requireModel(appConfig, "RAG rewrite")`。
> 修订（评审）：generate.ts:42 不在本项改——它由 #15 整体重写，会用 requireModel 作 model fn。**本项只改 rewrite.ts**。
> 行为变更：rewrite 当前是「无模型→null→createLlmNode fallback（用原 query 继续）」的优雅降级；换 requireModel 后改为抛错→被 [graph.ts:190](../../../../packages/deepagents-flow-ts/src/libs/topologies/rag/graph.ts) catch→整个 RAG 返回错误提示。即去掉 rewrite 的单节点降级，向 executeRAG 顶层 catch 收口（与其余拓扑「无 demo fallback」一致）。

### 11. llm-router 无 parse 守卫（+ docstring 同步）
[llm-router.ts:96](../../../../packages/deepagents-flow-ts/src/libs/nodes/llm-router.ts)：`parse` 未提供时 `parsed = content`（字符串）。在 `route` 调用前加守卫：若 `parse` 未提供 → `routeFallback(state, "error")`，避免 route 把字符串当对象取字段而静默放行。
> 修订（评审）：docstring（:41）现说「parse 缺省则 parsed=content 原文」——加守卫会废掉「无 parse 的字符串路由」这一设计特性，**必须同步把 docstring/选项注释改成「parse 必填」**，否则契约矛盾。优先级低（当前所有调用方都给 parse，custom blueprint 也总配 parse；纯防御未来手写节点）。

## Tier 3 — 架构（4 项）

### 12. reflect Command 边补全（精确小修复，不改 reflect.ts 逻辑）
- [custom.mjs](../../../../packages/deepagents-flow-ts/scripts/scaffold/blueprints/custom.mjs)：`renderNode` 的 `llm-router` 分支 + `render` 的 addNode 调用，从 `node.params.ends` 读取并渲染 addNode 第三参 `{ ends: [...] }`（仅 llm-router 需要）。
- [schema.mjs](../../../../packages/deepagents-flow-ts/scripts/scaffold/schema.mjs) `customNodeSchema`：`params` 增可选 `ends`（注：当前 params 是 `z.record(...)` 自由袋，ends 已能透传；如收紧成显式字段则在此加 `ends: z.array(z.string()).optional()`）。
- [router-gate/graph.ts:38](../../../../packages/deepagents-flow-ts/src/app/flows/router-gate/graph.ts) + `_example.router-gate.flow.json`：gate 节点补 `ends: ["draft", "__end__"]`，使 `gate→draft` 重做边正确反射。
- 修正 [reflect.ts:32](../../../../packages/deepagents-flow-ts/src/libs/topologies/reflect.ts) 与 [app/topology.ts](../../../../packages/deepagents-flow-ts/src/app/topology.ts) 注释：将「永远与真实连线一致」改为「对带 ends 的 Command 路由节点成立；漏 ends 的节点需补」。
- **验收**：inline tsx 反射 router-gate，应出现 `gate -> draft (cond)` 与 `gate -> __end__`。

### 13. MCP stdio 客户端合并为单一真相
`libs/mcp/stdio-client.ts` 为权威，`runtime/services/mcp-stdio.ts` 删除：
- 兼容关键点：[mcp-bridge.tool.ts:35](../../../../packages/deepagents-flow-ts/src/libs/tools/mcp-bridge.tool.ts) 需要 `listMcpTools` 返回**含 schema 的原始响应**，但 libs 版返回 `string[]`。处理：libs 版新增 `export async function listMcpToolsRaw(config, timeoutMs?): Promise<unknown>`（返回原始 tools/list result）；mcp-bridge.tool.ts 改 import 自 `libs/mcp/stdio-client.js`，`list_tools` 用 `listMcpToolsRaw`、`call_tool` 用 `callMcpTool`。
- 删除 `runtime/services/mcp-stdio.ts`（全仓仅此一个引用方），全局只剩一份 stdio MCP 实现（含唯一 `rateLimited` gate）。

### 14. custom condition 目标校验（文档 + 轻量加固）
静态分析 condition 返回值 ⊆ targets 不可行（运行时决定），COMPLETION_GATE 的 `graph` 反射不执行 condition 也捕获不到。故：
- [custom.mjs](../../../../packages/deepagents-flow-ts/scripts/scaffold/blueprints/custom.mjs) `renderEdge` conditional 分支加注释，并在生成末尾打印一行提醒：「conditional 边的 condition 返回值必须 ∈ targets，否则运行时抛 Invalid edge」。
- flow-builder/flow-scaffold SKILL.md / docs/node-catalog.md 增该约束说明。此项是接受限制 + 加固提醒，非逻辑改动。

### 15. RAG generate 复用 createLlmStreamNode（含 onToken 接线 + streaming 验收）
[generate.ts](../../../../packages/deepagents-flow-ts/src/libs/topologies/rag/nodes/generate.ts)：bespoke 的 `resolveModel + stream 循环 + try/catch` 替换为 `createLlmStreamNode`，消除与 llm.ts 的重实现漂移。
> **修订（评审，关键）**：这不是干净替换。RAG 的 onToken 经显式 `callbacks` 参数流转，而 `createLlmStreamNode`→`streamLLMText` 从 `lgConfig.configurable.onToken` 探测 sink。直接替换会使 `hasVisibleTokenSink=false` → 静默退回非流式。**落地步骤**：
> 1. 先把 onToken 接进 lgConfig.configurable（RAG graph 调 generate 时把 `config.callbacks.onToken` 放进 LangGraph runnable config 的 configurable，或在 generateNode 内构造带 onToken 的 config 传给 factory）。
> 2. model fn 用 `requireModel`（顺带覆盖 #10 对 generate 的诉求）。
> 3. write 回调保留 metadata 构造（buildMetadata）。
> 4. **验收**：unset 之外，跑一次真实 RAG streaming，确认 token 仍逐字 emit（typecheck/graph 盖不住的盲区）。
> 若 onToken 接线成本过高，可保留本项为「低优先/可选」——它是纯重构，收益最低、风险最高。

## 改动文件清单（代表）

- `src/libs/topologies/deep-research/nodes/review.ts`（#1）
- `src/runtime/context/model.ts`、`src/libs/nodes/model-resolver.ts`（#2）
- `scripts/scaffold/blueprints/custom.mjs`、`scripts/scaffold/schema.mjs`（#3,4,7,12,14）
- `src/libs/mcp/stdio-client.ts`、`src/libs/tools/mcp-bridge.tool.ts`、删 `src/runtime/services/mcp-stdio.ts`（#5,9,13）
- `src/libs/nodes/approval-finalize.ts`、`src/libs/nodes/llm-router.ts`（#6,11）
- `scripts/scaffold/specs/_example.*.flow.json`（~11 个，#7,8,12）
- `src/app/flows/grade-redo/graph.ts`、`src/app/flows/router-gate/graph.ts`（#8,12）
- `src/libs/topologies/rag/nodes/generate.ts`、`rewrite.ts`、`src/libs/topologies/rag/graph.ts`（#10,15）
- `src/libs/topologies/reflect.ts`、`src/app/topology.ts`（仅注释，#12）
- `packages/dev-agent-flow/skills/flow-builder/SKILL.md`、`docs/node-catalog.md`（#14）

## 验证

1. `pnpm typecheck`（tsc --noEmit，含 noUnusedLocals/Parameters）— 全程类型门。
2. `pnpm typecheck:examples` — examples 工程类型门。
3. `pnpm test`（vitest run）— node-kit/node-catalog/topology/layering 等。
4. `pnpm graph` + inline tsx 反射：router-gate 应出现 `gate -> draft (cond)`（#12 验收）；deep-research 边不回归。
5. 凭证：临时 unset provider 对应 env 跑一次 oneshot flow，确认 requireModel 抛清晰错误而非 401（#2）。
6. MCP：`mcp_tool_bridge` 的 `list_tools` 仍返回含 schema 的原始响应（#13 兼容）。
7. **RAG streaming 端到端**（#15 修订新增）：真实跑一次 RAG，确认 onToken 逐字 emit（typecheck/graph 盖不住）。
8. scaffold 回归：重新生成 grade-redo/router-gate，确认产物含 ends、verdict 默认 fail、attempts 计数（#3,4,8,12）。

## 实施顺序

Tier 1（1→8）→ typecheck/test →
Tier 2（9→11；**#10 与 #15 在 generate.ts 重叠，#15 提到 #10 前或两者一并处理**）→ typecheck →
Tier 3（12 先做，最小且解锁 reflect 验收；13 MCP 合并独立；14 文档；15 generate 重构最后，含 streaming 验收）→
全量 typecheck + typecheck:examples + test + graph 反射 + RAG streaming 验收。

## 风险与对策

1. **#15 静默丢 streaming**（最高风险）→ 先接 onToken 进 configurable + 加 streaming 端到端验收；成本过高则降级为可选。
2. **#10 去优雅降级**改变 RAG 失败语义 → 已明示，方向与其余拓扑一致（向顶层 catch 收口）。
3. **#11 契约矛盾** → 加守卫同步改 docstring。
4. **factory 抽象漏 bespoke** → 复杂场景明确保留 bespoke（deep-research 双源不硬塞）。
5. **catalog 词表 vs schema enum 漂移** → `tests/node-catalog.test.ts` 断言一致。

## 非目标

- 不替换现有 7 拓扑预设（它们是节点组合范例 + 手写优化版，保留）。
- 不把 deep-research 双源 merge / 文件交付等 bespoke 硬塞进 factory。
- 不在本计划处理 grade 节点的非 JSON 崩溃路（#8 仅修合法 JSON 缺键）。

## 执行结果（2026-06-22）

15/15 全部落地，终验全绿：`typecheck` + `typecheck:examples` + `test`（197 passed / 9 skipped）+ `pnpm graph` 反射 + RAG streaming 端到端（inline tsx `VERIFY_OK`）。两处执行中细化（已据实落地，超出原方案）：

- **#10（细化）**：rewrite 改 `requireModel` 后**保留 fallback**——无凭证经 requireModel 在 createLlmNode 的 try 外抛错（→ executeRAG 顶层 catch 兜底），调用失败（瞬态 429/超时）仍由 fallback 降级（用原 query 继续）。即「配置错误响亮失败、瞬态错误优雅降级」，优于一刀切去掉 fallback。RAG 测试相应 mock `resolveApiKey`（表达测试视为有凭证），非污染全局 env。
- **#15（关键发现）**：`emitTextToken`（emit.ts）原**缺 `configurable.onToken` 退路**（emitStage/emitPlan 都有双发，它只认 writer），故 RAG 经 invoke（无 streamMode writer）时即便接线 onToken 仍不 emit。落地补齐该退路（writer 优先 → 不影响现有 streamMode:"custom"），连带 `emitTextToken` 改 async + llm.ts 处 `await`。createLlmStreamNode 重构 generate 后经 inline tsx 验证逐 token emit（`["你好","，","世界"]`）。
- **#14**：约束落在三处——custom.mjs `renderEdge` 注释 + `generate` 运行时提醒 + 文档（node-catalog.md「edge 约束」节 + flow-builder `part2-orchestration.md` 条件边节）。
- **#12**：router-gate gate 补 `ends:["draft","__end__"]` 后反射出 `gate→draft (cond)` 与 `gate→__end__ (cond)`；grade-redo 经 `generate` 重新生成（verdict fail-closed + `attempts<3`）。
- **#13**：`runtime/services/mcp-stdio.ts` 删除（全仓唯一引用方 mcp-bridge 已改），mcp-bridge 改用 `libs/mcp/stdio-client` 的 `listMcpToolsRaw`（保留含 schema 的原始响应）。
