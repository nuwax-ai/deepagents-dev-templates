---
name: flow-scaffold
description: "deepagents-flow-ts 的一句话生成 Agent 脚手架：8 拓扑积木（7 预设 react-tools/human-in-loop/project-manager/travel-planner/rag/deep-research/dev-agent + custom 任意节点级编排）+ spec → 生成可跑薄封装 flow + 自动注册 + 自带 typecheck+graph 验证。一句话需求优先用它选拓扑+填槽，而非从零写图。需要把一句话/简单需求快速落地成可跑 flow 时使用。"
tags: [deepagents-flow-ts, scaffold, topology, generate, one-shot, template, coze, building-blocks]
version: "1.0.0"
license: MIT
---

# Flow 脚手架（一句话 → 可跑 Agent · 8 拓扑积木）

## When to Use

把**一句话需求 / 简单场景描述**快速落地成 `deepagents-flow-ts` 的**可跑 flow** 时使用。脚手架让你做**选择题 + 填空**（选拓扑 → 填 systemPrompt/参数），而不是**作文题**（从零写 StateGraph）。

> **节点选型**：有哪些 factory 节点 + 何时用见目标项目 `docs/node-catalog.md`（选型决策树 + `type` 词表）。命中 7 拓扑预设走生成器；预设之外用 `custom` 节点级 topology 按 nodes+edges+state 编排任意图（生成时渲染成真实 `graph.ts`，非运行时解释）。

> **优先级**：能用脚手架就用脚手架（快、自带验证、产物极薄）；只有需求**不属于任何预置拓扑**（bespoke 图）才走 `flow-builder` 手写。这就是「积木式」（对标 Coze 模板）与「自由编排」的分界。

## 它做什么

`node scripts/scaffold/generate.mjs <spec.json>`（在 `deepagents-flow-ts` 项目根执行）：

1. zod 校验 spec（拓扑 + 槽位参数）；
2. 按 topology 选 blueprint 渲染 → 写 `src/app/flows/<name>/index.ts`（**薄封装**，~15–40 行：import 拓扑 recipe/executor + getTopology，绑 spec）；
3. 自动注册到 `src/app/flows/index.ts` 的 flow 注册表（`SCAFFOLD-REGISTRY` 标记区，幂等）；
4. **自带 COMPLETION_GATE**：实跑 `pnpm typecheck && pnpm graph`，未过即报错（绝不声称成功）。

> 生成的是**真实可读、可手改、可被 inspector 可视化**的 TS（贴合「图是契约」范式，不引运行时解释层）。7 预设拓扑的图逻辑单一权威在 `src/libs/topologies/<name>/`（dev-agent 在 `src/app/topologies/`），生成物只是薄壳；**`custom` 例外**：图逻辑直接渲染进生成的 `src/app/flows/<name>/graph.ts`（无对应 libs 拓扑，spec 即该 flow 的权威）。

## 8 拓扑目录（先挑一个）

| topology | kind | 适用场景 | 节点结构 |
|------|------|----------|----------|
| `react-tools` | oneshot | 智能客服 / 任务工具型 / 通用问答 | `prepare → think ↔ tools → respond`（复用默认 ReAct 图） |
| `human-in-loop` | stateful-recipe | 内容审阅 / 审批 / 校对 / 可控生成 | `compose → review(interrupt) → finalize` |
| `project-manager` | stateful-recipe | 目标拆解 / 项目规划 / 带评审重做 | `plan → estimate → evaluate →(重做) approve(interrupt) → finalize` |
| `travel-planner` | stateful-recipe | 多源调研聚合 / 方案规划 | `gather → ⟨Send 并行⟩ research×N → aggregate → confirm(interrupt) → finalize` |
| `rag` | oneshot | 知识库问答 / 检索增强 / 带来源引用 | `rewrite → retrieve(MCP) → grade(重试) → prepare → generate` |
| `deep-research` | stateful-recipe | 深度研究报告 / 长任务多阶段 + 持续会话 | `clarify → plan → outline_gate →(Send) research → review → draft → converse ↔ respond → delivery` |
| `dev-agent` | stateful-custom | 综合编码/运维助手（ReAct + 多轮 + 压缩） | 复用默认 ReAct 图 + 多轮续接 + applyCompaction |
| `custom` ⭐ | stateful-recipe | **任意自定义编排**：上面预设都不命中时，按 nodes+edges+state 自由编排 | spec 声明 state/nodes/edges → **生成时渲染成真实 `graph.ts`**（节点目录 factory + 内联代码，受 tsc 检查；见下「节点级编排」） |

**`custom`（节点级编排）**：7 个预设之外的图。spec 的 `params` 声明 `state`（channels+reducer 类型）/`nodes`（name→type+params，type 词表见目标项目 `docs/node-catalog.md`）/`edges`（static/conditional/fanout）/`input`/`result`。节点回调（prompt/write/route/retrieve）写箭头函数字符串——**生成时原样内联为真实代码**（受 tsc 检查，非运行时 eval）。blueprint 渲染出 `src/app/flows/<name>/{graph.ts,index.ts}`（custom 比其他拓扑多一个真实 `graph.ts`）。注意：回调不用的参数须省略（如 `() => ({})`），llm-router 的 `route` 第一参数为 `unknown` 须 `as` 断言。局限（生成后手改）：llm-stream/tool-exec/subgraph 节点、自定义 reducer。示例：`scripts/scaffold/specs/_example.translate-review.flow.json`。

**kind 三类**（决定 flow 注册表项形态，由 blueprint 自动产出，你不用管）：
- `oneshot`：生成 FlowExecutor（react-tools / rag）。
- `stateful-recipe`：生成 recipe，由组合根 `index.ts` 的 `materializeFlow` 包成 StatefulFlow（4 个 stateful 拓扑）。
- `stateful-custom`：手写 run-loop 的 StatefulFlow（dev-agent，复用默认图 + 压缩）。

## spec 契约（写一个 .json）

```jsonc
{
  "name": "kebab-case-名",           // 必填，小写字母开头，仅 a-z/0-9/连字符
  "description": "一句话场景说明",     // 可空
  "flowType": "oneshot | stateful",   // 默认 oneshot
  "topology": "react-tools",          // 必填，见上表
  "systemPrompt": "目标 Agent 系统提示词",  // 见下方「注入规则」
  "tools": [],                        // 预留（当前拓扑用 runtime.allTools；per-flow 工具绑定待增强）
  "params": {}                        // 拓扑特定参数；仅 rag 用 mcpServers（见下）
}
```

**rag 的 `params.mcpServers`**（检索源 stdio MCP，语义名 → 配置）：

```jsonc
"params": {
  "mcpServers": {
    "duckduckgo": { "command": "npx", "args": ["-y", "duckduckgo-mcp-server"] }
  }
}
```

### systemPrompt 注入规则（按拓扑）

| 拓扑 | systemPrompt 是否注入 |
|------|----------------------|
| react-tools | ✅ 注入 think 节点：`spec.systemPrompt || runtime.systemPrompt`（场景优先；spec 空时回退框架） |
| human-in-loop / project-manager / travel-planner | ✅ 注入主节点：`spec.systemPrompt`（场景优先；spec 空时图用**领域默认**，不混入框架 prompt） |
| rag / deep-research / dev-agent | ⚠️ 不注入：检索/多阶段/默认图用领域 prompt，通用 persona 不适配；spec.systemPrompt 留空即可 |

> 目标 Agent 的**系统提示词设计**（角色/能力/few-shot/输出规范）走 `flow-prompt-designer` skill；本脚手架只把写好的 prompt 注入对应拓扑。

## 完整流程（5 步）

| 步 | 动作 | 命令 / 产出 |
|----|------|------------|
| 1 | **选拓扑** | 对照上方目录，挑最接近需求的；都不接近 → 走 `flow-builder` 手写 |
| 2 | **写 spec** | 在 `scripts/scaffold/specs/` 建 `<name>.flow.json`（参考同目录 `_example.*.flow.json`） |
| 3 | **生成** | `node scripts/scaffold/generate.mjs scripts/scaffold/specs/<name>.flow.json` → 写薄封装 + 注册 + typecheck+graph 自验 |
| 4 | **激活** | 把 `config/flow-agent.config.json` 顶层 `"activeFlow"` 设为 `<name>` |
| 5 | **验证 / 试跑** | `pnpm graph`（看该 flow 拓扑）、`pnpm flow "..."`（试跑）、`pnpm test`（含 layering 守卫） |

> 生成器 COMPLETION_GATE 只跑 typecheck+graph（快）；改完代码后仍须按 `flow-builder` Step 7 跑完整 `pnpm build && pnpm typecheck && pnpm test && pnpm graph` 再报告完成（系统提示词 `<COMPLETION_GATE>`）。

## 生成物长什么样（示例：human-in-loop 拓扑）

```typescript
// src/app/flows/content-review/index.ts（scaffold 生成，可手改，~25 行）
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../../../libs/topologies/types.js";
import { reviewRecipe, getReviewTopology } from "../../../libs/topologies/human-in-loop/index.js";

const FALLBACK_SYSTEM_PROMPT = "你是资深内容编辑…";
export const recipe = (runtime: FlowRuntime): StatefulTopologyRecipe =>
  reviewRecipe(runtime, { systemPrompt: runtime.systemPrompt || FALLBACK_SYSTEM_PROMPT }) as StatefulTopologyRecipe;
export const getTopology = () => getReviewTopology();
```

图逻辑（compose/review/finalize 节点 + State + 拓扑反射 + recipe）在 `src/libs/topologies/human-in-loop/`，**单一权威**；改拓扑改那里，改场景提示词改这里的 FALLBACK。

## vs `flow-builder`（何时手写）

| 场景 | 用 |
|------|-----|
| 需求命中预设 7 拓扑，或预设外但可用 `custom` 节点级编排 | **flow-scaffold**（生成 + 自验） |
| 需要 bespoke 图（独特节点/连线、不在目录的拓扑、深度定制 State） | `flow-builder`（手写 StateGraph + factory） |
| 生成后要微调 | 先 scaffold 生成薄壳，再手改 `src/app/flows/<name>/index.ts` 或直接改 `libs/topologies/<name>/` |

> 已有生成 flow 可叠加：不同场景名 → 不同薄壳，共享同一拓扑图逻辑。`activeFlow` 切换即用。

## 新增拓扑（扩目录，进阶）

需要把一个 bespoke 图沉淀成可复用拓扑时（让它进目录）：
1. 图逻辑落 `src/libs/topologies/<name>/`：`graph.ts`（createXxxGraph，零 surface 依赖）+ `topology.ts`（getXxxTopology，用 `reflectTopology`）+ `recipe.ts`（xxxRecipe，stateful）或 `executor.ts`（oneshot）+ `index.ts` barrel。
2. blueprint：`scripts/scaffold/blueprints/<name>.mjs`（导出 `kind` + `render(spec)`）。
3. 注册：`schema.mjs` discriminatedUnion 加成员 + `generate.mjs` BLUEPRINTS 加一行。
4. 约束：stateful 拓扑只能导出 recipe（`createStatefulFlow` 在 surfaces，libs/app 不能 import，由组合根 `materializeFlow` 物化）；recipe 边界 `as StatefulTopologyRecipe` 擦除 state 泛型。

## Anti-patterns

- ❌ 一句话需求上来就 `flow-builder` 手写整张图（能用脚手架的别手写——慢、易错、不自验）。
- ❌ 手改 `src/app/flows/index.ts` 的 `SCAFFOLD-REGISTRY` 标记区（生成器自动维护，手改会被覆盖或错乱）。
- ❌ 生成后不改 `activeFlow` 就说「生效了」（必须改 config 的 `activeFlow` 才切到新 flow）。
- ❌ 在 `src/libs/topologies/` 的图逻辑里 import `surfaces/`（分层违规，`tests/layering.test.ts` 会红；stateful 经 recipe + 组合根桥接）。
- ❌ 给 rag/deep-research/dev-agent 填 `systemPrompt` 却期望注入（这三类用领域 prompt，不注入）。
- ✅ 命中拓扑 → scaffold 生成 → 改 activeFlow → `pnpm graph` + `pnpm flow` 验证。
- ✅ 生成器报错就读错误改 spec 重跑（zod 校验信息可读，COMPLETION_GATE 失败有真实输出）。
