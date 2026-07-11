# Part 1：固定流程型 —— 图选型与手写落地（含 HITL 人审）

> 所属：`flow-builder` L2-A。入口路由见上级 [SKILL.md](../SKILL.md)。
> **本框架无脚手架、无 `src/libs/topologies/` 预设图、无内置场景 flow**（注册表仅 `default` ReAct）。固定流程型一律**直接改 `src/app/graph.ts`** 手写落地；本 Part 负责「选型 + 落地骨架」，编排细节见 [part2-orchestration.md](part2-orchestration.md)。
> 旧文件名 `part1-scaffold.md` 仅为兼容重定向 stub，权威正文即本文件。

把**固定流程型**需求落地成可跑 flow：先按范式**选型**（定 state/nodes/edges），再在 `src/app/graph.ts` **手写连线**，节点优先 `src/libs/nodes/` factory。流程内若某步需审批/人工复核/定稿，加 **HITL 人审节点**（interrupt+resume），它是固定流程型下的一种编排，不是独立形态。

> **第 0 问（先于选型）**：是否改图 → [part0-workflow.md](part0-workflow.md) § Phase 1 第 0 问 / `docs/examples.md` § 先判定。**default 够用**（开放追问 + systemPrompt + 平台能力）→ **不进本 Part、不写图**。仅当能说明「default 为什么不够」（必须固定阶段 / Send 并行 / HITL 等）时，才进本 Part 手写图。

> **节点选型**：`docs/node-catalog.md`（决策树 + `type` 词表）+ `docs/node-kit.md`（factory API）。

## 图选型速查（照范式定结构）

| 需求形态 | 图结构（节点 → 边） | 关键 factory / API | 文字范式 |
|----------|---------------------|--------------------|----------|
| **线性管道**（翻译 / 摘要 / 打分 / 生成报告） | `prepare → step1 → step2 → …（END）` | `createPrepareNode` / `createLlmStreamNode`（用户可见输出） | `docs/examples.md` |
| **检索增强问答（RAG）** | `rewrite → retrieve → grade → prepare → generate` | `createMcpRetrievalNode` + `createLlmStreamNode`；`grade` 条件重试 | `docs/examples.md` § 检索增强问答 |
| **条件重试 / 自纠正** | `… → grade →(条件边)→ rewrite / generate` | `addConditionalEdges`（**R-G004** 返回值 ∈ targets） | `docs/flow-patterns.md` |
| **多源并行聚合** | `gather → Send research×N → aggregate（流式）` | `Send` + reducer；`aggregate` 用 `createLlmStreamNode` | `docs/flow-patterns.md` |
| **流程内人审（纯文本）** | `compose → review(interrupt) → finalize` | `createHumanApprovalNode` + `createApprovalFinalizeNode` | `docs/examples.md` § 人工确认；Part 2 § HITL |
| **流程内人审（结构化表单）** | `compose → present_review → review(interrupt) → finalize` | `present_review` 内 direct-invoke 平台 ask-question MCP 工具展示表单，`review` 用 `createHumanApprovalNode` 收回复（**两节点必拆**） | Part 2 § HITL 选型 |
| **reflection（评审重做）** | `plan → evaluate →(路由)→ redo / finalize` | `createLlmRouterNode`（Command goto 须声明 `ends`）或条件边 | `docs/flow-patterns.md` |

> **新建图必须能说明「default 为什么不够」**（固定阶段顺序、需 Send 并行、需 HITL interrupt 等），说不出就回落聊天助手型（默认图 + systemPrompt）。

## 落地 5 步

| 步 | 动作 |
|----|------|
| 0 | **需平台能力**（见 [part3-tools-config.md](part3-tools-config.md) § 平台能力登记；**联网搜索较常见**）→ 先 `dev-engineer-toolkit` 搜平台并 `add-tool`，**再**写图 |
| 1 | 按上表选型；拿不准结构 → [part2-orchestration.md](part2-orchestration.md) 编排模式速查 + `docs/examples.md` |
| 2 | `src/app/state.ts`：`Annotation.Root` 定 state（Send 并行的 channel 加 reducer） |
| 3 | `src/app/graph.ts`：factory 建节点 + `addNode` / `addEdge` / `addConditionalEdges` 连线（节点名 ≠ channel 名，**R-G007**；用户可见输出用 `createLlmStreamNode` + `r.text`，**R-G009**） |
| 4 | 有状态 → `createStatefulFlow`（**禁止手写外层 run-loop**）；HITL 用默认（暴露 `hasStarted`，interrupt/resume），对话型加 `conversational: true` |
| 5 | `pnpm graph` 核对拓扑 + `pnpm flow` 快检 + [part4a-verify-debug.md](part4a-verify-debug.md)；**收工必读** [part4b-smoke.md](part4b-smoke.md)（`flow.active` + flow-debugger 真实调试） |

> **是否新建独立 flow？** 默认不要新建。多数场景直接改**默认图** `src/app/graph.ts` 即可（`flow.active: "default"` 复用）。仅当用户明确要求同一项目内保留多套可切换图，且能说明“为什么不能覆盖默认图”时，才在 `src/app/flows/` 手写 `FlowDef` 并注册到 `src/app/flows/index.ts`（对照现有 `default` 项：`profile` / `recipe` / `getTopology`）；否则不要扩展注册表。

## 手写落地示例（HITL 图骨架）

```typescript
// src/app/graph.ts（节选）：compose(流式) → review(interrupt) → finalize
import { StateGraph, START, END } from "@langchain/langgraph";
import { createLlmStreamNode, createHumanApprovalNode, createApprovalFinalizeNode } from "../libs/nodes/index.js";

export function createFlowGraph(cfg: CreateFlowGraphConfig) {
  return new StateGraph(FlowState)
    .addNode("compose", createLlmStreamNode({ /* write: (r) => ({ draft: r.text }) */ }))
    .addNode("review", createHumanApprovalNode({ /* interrupt 收人审意见 */ }))
    .addNode("finalize", createApprovalFinalizeNode({ /* rejectedLlm.write 读 r.text */ }))
    .addEdge(START, "compose")
    .addEdge("compose", "review")
    .addEdge("review", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer: cfg.checkpointer });
}
```

物化由组合根 `src/index.ts` 的 `materializeFlow` 调 `createStatefulFlow({...recipe, checkpointer, appConfig})` 完成；recipe 见 `src/app/default-flow.ts` 样式（`buildGraph` / `toInput` / `toResult`）。

## systemPrompt 注入

主对话 / compose 类节点的系统提示词由 `runtime.systemPrompt` 经 `createFlowGraph({ systemPrompt })` 注入（见 `src/app/default-flow.ts`）；提示词**写什么**见 [part5-prompt-design.md](part5-prompt-design.md)，**存哪里**经 `dev-engineer-toolkit` 同步平台。

## vs Part 2 手写

本 Part 给「选型 + 落地骨架」；State/节点/条件边/Send/子图/HITL 的**完整编排细节**在 [part2-orchestration.md](part2-orchestration.md)。图规则（R-G001+）见当前工作目录 `docs/flow-graph-rules.md`。

## Anti-patterns

- ❌ 聊天助手型（追问/开放泛化）也去手写图（应 `flow.active: "default"` + systemPrompt）
- ❌ 妄图 `flow.active` 切到某个内置场景 demo（注册表仅 `default`）
- ❌ 恢复 `scripts/scaffold/` 或 `src/libs/topologies/` 作为入口
- ❌ 手写外层 run-loop（用 `createStatefulFlow`）
- ❌ 节点名与 state channel 同名（**R-G007**）
- ❌ 用户可见大段输出用 `createLlmNode` 或 `write` 写 `r.content`（应 `createLlmStreamNode` + `r.text`，**R-G009**）
- ❌ 条件边 condition 返回值不在 targets 列表内（**R-G004**，运行时 `Invalid edge`）
- ✅ 选型 → 定 state → factory 建节点 → graph.ts 连线 → flow.active → 验证
