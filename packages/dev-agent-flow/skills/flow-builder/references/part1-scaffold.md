# Part 1：脚手架（一句话 → 可跑 Agent）

> 所属：`flow-builder` L2-A。入口路由见上级 [SKILL.md](../SKILL.md)。

把**一句话需求**落地成可跑 flow：**选择题 + 填空**（选拓扑 → 填参数），不要从零写 StateGraph。

> **节点选型**：`docs/node-catalog.md`（决策树 + `type` 词表）。8 预设走生成器；预设外用 `custom` 按 nodes+edges+state 编排（生成真实 `graph.ts`）。

## 生成器

`node scripts/scaffold/generate.mjs <spec.json>`（在 `deepagents-flow-ts` 项目根）：

1. zod 校验 spec；
2. **`lint-graph-rules.mjs` 静态检**（**R-G001** parse/write、**R-G007** 节点名 ≠ channel、**R-G009** 流式 write 须 `r.text`；失败则中止）；
3. blueprint 渲染 → `src/app/flows/<name>/`（薄封装或 custom 含 `graph.ts`）；
4. 自动注册 `src/app/flows/index.ts`（`SCAFFOLD-REGISTRY` 区，勿手改）；
5. 自带门禁：`pnpm typecheck && pnpm graph`（临时切换 `activeFlow` 反射新 flow）。

8 预设图逻辑权威在 `src/libs/topologies/<name>/`（dev-agent 在 `src/app/topologies/`）；**`custom`** 图逻辑渲染进 `src/app/flows/<name>/graph.ts`。

## 9 拓扑目录（8 预设 + `custom`）

| topology | kind | 适用场景 | 节点结构 |
|------|------|----------|----------|
| `react-tools` | oneshot | 客服 / 工具型 / 通用问答 | `prepare → think ↔ tools → respond` |
| `human-in-loop` | stateful-recipe | 审阅 / 审批 / 校对 | `compose(流式) → review(interrupt) → finalize` |
| `project-manager` | stateful-recipe | 规划 + 评审重做 | `plan → estimate → evaluate → approve → finalize` |
| `travel-planner` | stateful-recipe | 多源调研聚合 | `gather → Send research×N → aggregate(流式) → confirm → finalize`（**research 须接平台搜索 MCP**，见 Part 3 § 联网搜索） |
| `rag` | oneshot | 检索问答 | `rewrite → retrieve → grade → prepare → generate` |
| `adaptive-rag` | oneshot | 自适应检索 + 路由自纠正 | `route → retrieve/web-search → grade → transform/generate`（**web_search 优先平台 Plugin/MCP**） |
| `deep-research` | stateful-recipe | 深度研究 / 长任务 | 多阶段 + Send + 持续会话 |
| `dev-agent` | stateful-custom | 综合助手 ReAct + 压缩 | 默认 ReAct + 多轮续接 |
| `custom` ⭐ | stateful-recipe | 预设都不命中 | spec 声明 state/nodes/edges → 生成 `graph.ts` |

**`custom`**：`params` 含 `state`/`nodes`（type 见 node-catalog，**用户可见输出用 `llm-stream`**）/`edges`/`input`/`result`；回调写箭头函数字符串，生成时内联为真实 TS。局限（生成后手改）：tool-exec、subgraph、自定义 reducer。流式范例：`_example.translate-review`、`_example.multi-aspect-search`、`_example.router-gate`、`_example.interview-agent`（`llm-stream` + `r.text`）；非流式教学：`_example.grade-redo`；`interview-agent` 的 `prepare`/`evaluate` 仍 `llm`（无 `r.text` / 结构化 parse）。

**custom spec 生成后核对**（目标项目 `docs/flow-graph-rules.md`；生成前已由 `lint-graph-rules.mjs` 拦 **R-G001 / R-G007 / R-G009**）：

- 有 `"parse"` 的节点 → `write` 必须引用 `r.parsed`（**R-G001**）
- **`llm-stream` / `approval-finalize.rejectedLlm`** → `write` 必须用 **`r.text`**，禁止 `r.content`（**R-G009**）
- 节点名不得与 `state` channel 同名（**R-G007**，如节点 `writeReport` 写 channel `report`）
- `__start__` 后第一个 `llm` 节点 → 默认不加 `parse`；入口 prompt 须容忍非预期输入（**R-G002**）
- 手改 `graph.ts` → **同步** `scripts/scaffold/specs/<name>.flow.json`（**R-G003**）

**kind**：`oneshot` | `stateful-recipe` | `stateful-custom`（由 blueprint 自动产出）。

## spec 契约

```jsonc
{
  "name": "kebab-case",
  "topology": "react-tools",
  "flowType": "oneshot | stateful",
  "systemPrompt": "…",
  "params": {}
}
```

**rag** / **adaptive-rag** 可加 `params.mcpServers`（stdio MCP 语义名 → 配置）。

### systemPrompt 注入

| 拓扑 | 注入 |
|------|------|
| react-tools / human-in-loop / project-manager / travel-planner | ✅ 注入主节点 |
| rag / adaptive-rag / deep-research / dev-agent | ⚠️ 不注入 |

> 提示词设计 → [part5-prompt-design.md](part5-prompt-design.md)；本处只把写好的 prompt 填进 spec。

## 5 步流程

| 步 | 动作 |
|----|------|
| 1 | 选拓扑；不接近 → `custom`；仍不行 → [part2-orchestration.md](part2-orchestration.md) |
| 2 | 写 `scripts/scaffold/specs/<name>.flow.json` |
| 3 | `node scripts/scaffold/generate.mjs scripts/scaffold/specs/<name>.flow.json` |
| 4 | `config/flow-agent.config.json` → `"activeFlow": "<name>"` |
| 5 | `pnpm graph` + `pnpm flow` + [part4a-verify-debug.md](part4a-verify-debug.md) 完整验证；**custom flow 必读** [part4b-smoke-acp.md](part4b-smoke-acp.md)（`activeFlow` + `.env` + `SMOKE_PROMPT`） |

## 生成物示例（human-in-loop 薄封装）

```typescript
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import { reviewRecipe, getReviewTopology } from "../../../libs/topologies/human-in-loop/index.js";

export const recipe = (runtime: FlowRuntime) =>
  reviewRecipe(runtime, { systemPrompt: runtime.systemPrompt || FALLBACK }) as StatefulTopologyRecipe;
export const getTopology = () => getReviewTopology();
```

## vs Part 2 手写

| 场景 | 路径 |
|------|------|
| 命中 8 预设或 `custom` | Part 1 生成 |
| bespoke 图 / 深度定制 State | [part2-orchestration.md](part2-orchestration.md) |
| 生成后微调 | 手改 `flows/<name>/` 或 `libs/topologies/<name>/` |

## 新增拓扑（进阶）

1. `src/libs/topologies/<name>/`（graph + topology + recipe/executor）
2. `scripts/scaffold/blueprints/<name>.mjs`
3. `schema.mjs` + `generate.mjs` 注册

## Anti-patterns

- ❌ 一句话需求直接 Part 2 手写整张图
- ❌ 手改 `SCAFFOLD-REGISTRY`
- ❌ 不改 `activeFlow` 就说生效
- ❌ `libs/topologies/` import `surfaces/`
- ❌ custom spec 里 `parse` 与 `write` 不匹配（write 不读 `r.parsed`）
- ❌ 用户可见节点用 `type: "llm"` 或 `write` 写 `r.content`（应 `llm-stream` + `r.text`，**R-G009**）
- ❌ 只改生成后的 `graph.ts` 不回写 spec
- ✅ 命中 → 生成 → activeFlow → 验证
