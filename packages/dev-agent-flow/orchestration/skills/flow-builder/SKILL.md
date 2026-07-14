---
name: flow-builder
description: "在当前工作目录开发或改造 LangGraph Flow 时使用。负责把目标项目 docs/ 里的技术事实落成施工步骤：Phase 0–4 总流程与收工清单（part0）；需求分类与图选型——先判定默认 ReAct 是否够用，固定阶段/Send 并行/HITL 人手写图（part1）；手写 StateGraph、流式输出 R-G009、HITL 选型（part2）；自写工具、平台能力登记、Plugin/技能登记、联网搜索、permissions 工具审批（part3）；验证排错与 HITL 卡死排查（part4a）；flow-debugger 真实执行/工具断言收工必经（part4b，pnpm flow 不能替代）；目标 Agent 系统提示词设计、用户输入提炼与平台同步（part5，禁止 AGENT.md）；子智能体/subagent 委派（part6，禁止 .agents/agents/）；Skill 集成（part7，禁止本地写 .agents/skills/）。图规则 R-G001+ / factory API / 术语分别读当前工作目录 docs/flow-graph-rules.md、node-kit.md、glossary.md；选型权威表读 docs/examples.md。本 Skill 只路由与步骤，不复制模板技术规则；平台在线配置读写交给 dev-engineer-toolkit；真实链路验证交给 flow-debugger。Keywords: flow开发, StateGraph, LangGraph, HITL, flow-debugger, 工具绑定, subagent, systemPrompt, 平台能力, 联网搜索, permissions, 流式输出, parseJson, 固定流程, ReAct, flow-builder, R-G009"
tags: [flow, orchestration, tools, prompt, subagent, stategraph, hitl, debug]
version: "3.5.0"
---

# Flow 开发（当前工作目录）

## 分层结构

```
flow-builder/
├── SKILL.md                 ← L1 入口（本文件）：路由 only
└── references/
    ├── part0-workflow.md          ← 端到端流程 / completion gate 清单 / LangGraph 文档 / 内置工具
    ├── part1-fixed-flow.md        ← 固定流程型：图选型 + 手写 src/app/graph.ts 落地（含 HITL 人审）
    ├── part2-orchestration.md
    ├── part3-tools-config.md
    ├── part4a-verify-debug.md
    ├── part4b-smoke.md          ← flow-debugger 真实调试（保留文件名兼容旧链接）
    ├── flow-graph-rules-pointer.md
    ├── part5-prompt-design.md
    ├── part6-subagent.md
    └── part7-skill.md
```

**渐进加载**：`load_skill` 只加载本 SKILL.md 正文；详细步骤须 `Read` 本目录下 `references/partN-*.md`，**每次只开一个 Part**。参数/API 脚本见 `dev-engineer-toolkit/references/api-docs.md`。

## When to Use

| 场景 | 读取 |
|------|------|
| **会话启动 / Phase 0–4 总流程 / 收尾清单** | **[part0-workflow.md](references/part0-workflow.md)** |
| **需求分类（先判定 default 是否够用；命中能力门槛才改图）** | **[part0-workflow.md](references/part0-workflow.md)** § Phase 1 第 0 问；权威表见目标项目 `docs/examples.md` |
| 必须固定阶段 / Send 并行 / HITL → 图选型 + 落地 | [part1-fixed-flow.md](references/part1-fixed-flow.md) |
| 手写 StateGraph | [part2-orchestration.md](references/part2-orchestration.md) + [flow-graph-rules-pointer.md](references/flow-graph-rules-pointer.md) |
| 自写工具 / 平台能力 / 变量 | [part3-tools-config.md](references/part3-tools-config.md) |
| 验证 / 跑不通 / HITL 排查 | [part4a-verify-debug.md](references/part4a-verify-debug.md) |
| **flow-debugger / 真实执行 / 工具调用断言 / HITL 调试** | **[part4b-smoke.md](references/part4b-smoke.md)**（**收工必经**，非仅排错） |
| `parseJson` / `LLM 未返回 JSON` / 图编排硬规则 | [flow-graph-rules-pointer.md](references/flow-graph-rules-pointer.md) → 当前工作目录 `docs/flow-graph-rules.md`（R-G001+） |
| **无流式 / 整段一次性输出 / 用户可见 LLM 文本** | **[part2-orchestration.md](references/part2-orchestration.md) § 流式输出** + **R-G009** |
| **平台能力 / 外部工具 / Plugin / 技能登记** | **[part3-tools-config.md](references/part3-tools-config.md) § 平台能力登记** + `dev-engineer-toolkit` |
| **联网 / 网页搜索 / 实时资讯**（**较常见**） | Part 3 § **联网搜索**（在平台能力登记之上） |
| 工具审批 / `Permission denied` / `permissions` 配置 | [part3-tools-config.md](references/part3-tools-config.md) + [part4a-verify-debug.md](references/part4a-verify-debug.md) |
| HITL 结构化表单 / **平台问答卡片** | [part2-orchestration.md](references/part2-orchestration.md) § HITL 选型；术语见当前工作目录 `docs/glossary.md` |
| 设计目标 Agent 提示词 / **用户输入提炼** / 平台同步 | **[part5-prompt-design.md](references/part5-prompt-design.md)** |
| 创建/命名目标 Agent（通用智能体） | [part5-prompt-design.md](references/part5-prompt-design.md) + `dev-engineer-toolkit`；**禁止** `AGENT.md` |
| 子智能体 / subagent / 委派（平台或内置） | [part6-subagent.md](references/part6-subagent.md)；**禁止** `.agents/agents/` |
| subagent 未知工具 / Invalid model / 并行混流 | [part6-subagent.md](references/part6-subagent.md) + [part4a-verify-debug.md](references/part4a-verify-debug.md) § Subagent |
| 技能 / skill（平台或内置） | [part7-skill.md](references/part7-skill.md)；**禁止**本地写 `.agents/skills/` |

> LangGraph TS API → 官方文档：见 [part0-workflow.md](references/part0-workflow.md) § LangGraph 文档。

## 推荐路径

```
会话启动 → part0（依赖 / 系统提示词基线 / 读 docs）
图选型 → 先读目标项目 docs/examples.md，再按结论选择 Part 1 / Part 2 或默认路径
平台能力 → Part 3 + dev-engineer-toolkit；真实链路验证 → Part 4 + flow-debugger
收工 → 目标项目 README 工程验证矩阵 + Part 0 的执行步骤 + 系统提示词平台门禁
系统提示词 / 用户输入提炼？→ part5（含平台同步）→ dev-engineer-toolkit
跑不通 / HITL 卡住？→ part4a 排错（**不替代** part4b 收工）
```

## 当前工作目录文档（项目自洽，开发 Agent 按需读取）

### 谁读谁（与本技能 `references/` 的关系）

| 读什么 | 在哪 | 回答什么 |
|--------|------|----------|
| **规格 / API / 规则** | 当前工作目录 `docs/`（权威） | 有哪些节点、factory 怎么用、R-G00x、术语、排错 |
| **施工流程 / 门禁** | 本技能 `references/part*.md` | 先做哪步、平台怎么登记、何时收工、completion gate |

- Part* **引用** `docs/`，**不复制** node-kit / R-G 全文；改规则只改目标项目 `docs/flow-graph-rules.md`（`flow-graph-rules-pointer.md` 只是索引）。
- 开发 Agent：**先**按 Part0 路由打开对应 Part，**再**按需 `Read` `docs/`；人读项目：只看 `docs/` + `README.md` 即可。

下列路径均在**当前工作目录**内：

`README.md` · `docs/README.md` · `docs/glossary.md` · `docs/flow-graph-rules.md` · `docs/node-catalog.md` · `docs/node-kit.md` · `docs/flow-patterns.md` · `docs/examples.md` · `docs/troubleshooting.md` · `docs/capabilities.md` · `scripts/README.md`

## 关联技能

| 技能 | 何时用 |
|------|--------|
| `dev-engineer-toolkit` | 平台在线配置读写；**写图前** search-apis / search-skills / get-config / add-tool；part5 保存与回读 |
| `flow-debugger` | **收工必经**：`debug.sh --with-logs` + `--expect-tool`；**`pnpm flow` 不能替代** |

## L1 约束

- 模板技术事实只读当前工作目录 `README.md` 与 `docs/`；本 Skill 不复制图规则、factory API、目录结构或验证矩阵。
- 图选型先读 `docs/examples.md`，图规则 / factory API / 术语分别读 `docs/flow-graph-rules.md`、`docs/node-kit.md`、`docs/glossary.md`。
- 本 Skill 的职责是把这些事实落成步骤：按需读取一个 Part，平台操作交给 `dev-engineer-toolkit`，真实链路验证交给 `flow-debugger`。
- 平台回读、防开发 Skill 污染和可否对外报完成遵守开发 Agent `system-prompt.md`；工程验证范围遵守目标项目 README。
