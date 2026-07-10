---
name: flow-builder
description: "在当前工作目录开发 LangGraph Flow 时使用。覆盖：Part0 端到端流程与 completion gate；Part1 固定流程型/人工确认型脚手架；Part2 StateGraph 编排（HITL/流式/问答卡片）；Part3 工具与平台能力绑定（写图前须配合 dev-engineer-toolkit 搜索登记，含联网搜索）；Part4 验证调试与 flow-debugger 真实调试；Part5 系统提示词与用户输入提炼；Part6 子智能体委派；Part7 技能集成。适用于新建/修改 flow、聊天助手型默认路径、图规则 R-G001+、跑不通或平台真实执行排查。禁止写 .agents/；LangGraph TS API 查官方文档。Keywords: flow开发, scaffold, StateGraph, LangGraph, HITL, flow-debugger, 工具绑定, subagent, systemPrompt, 平台能力, 联网搜索, flow-builder"
tags: [flow, scaffold, orchestration, tools, prompt, subagent, stategraph, hitl, debug]
version: "3.3.1"
---

# Flow 开发（当前工作目录）

## 分层结构

```
flow-builder/
├── SKILL.md                 ← L1 入口（本文件）：路由 only
└── references/
    ├── part0-workflow.md          ← 端到端流程 / completion gate 清单 / LangGraph 文档 / 内置工具
    ├── part1-scaffold.md
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
| **需求分类（聊天助手型 vs 固定流程型 vs 人工确认型）** | **[part0-workflow.md](references/part0-workflow.md)** § Phase 1 第 0 问 |
| 一句话需求 → 可跑 flow | [part1-scaffold.md](references/part1-scaffold.md) |
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
第 0 问（part0 § Phase 1）：多轮对话 / 追问 / 泛化？→ 聊天助手型（flow.active=default + 平台能力登记 + part5 systemPrompt，不写图）
              └ 固定流程型 / 人工确认型？→ 继续 ↓
需工作区外能力（Plugin/技能/外部 API；联网搜索较常见）？→ part3 § 平台能力登记（强制，写图前）→ dev-engineer-toolkit → add-tool 后加载 flow-debugger
              └ 含联网？→ 追加 part3 § 联网搜索
              └ part1 命中？→ 生成 → part2 实现
开发迭代快检：pnpm flow / pnpm flows / debug.sh 短 prompt（**非** completion gate；**禁止 pnpm exec tsx**）
收工（顺序写死）：part0 § Phase 3 → 静态三连 → flow-debugger debug.sh --with-logs [--expect-tool] → part0 § Phase 4 报告（含「flow-debugger 证据」小节）
                    └ custom？→ part1 custom → part2 → part3（若 Phase 1 未做）→ Phase 3 收工
系统提示词 / 用户输入提炼？→ part5（含平台同步）→ dev-engineer-toolkit
跑不通 / HITL 卡住？→ part4a 排错（**不替代** part4b 收工）
```

## 当前工作目录文档（项目自洽，开发 Agent 按需读取）

下列路径均在**当前工作目录**内；描述当前项目能力与配置，**不**包含开发 Agent 工作流（工作流见本技能 Part*）：

`README.md` · `docs/glossary.md` · `docs/flow-graph-rules.md` · `docs/node-catalog.md` · `docs/node-kit.md` · `docs/flow-patterns.md` · `docs/troubleshooting.md` · `docs/capabilities.md` · `scripts/README.md`

## 关联技能

| 技能 | 何时用 |
|------|--------|
| `dev-engineer-toolkit` | 平台在线配置读写；**写图前** search-apis / search-skills / get-config / add-tool；part5 保存与回读 |
| `flow-debugger` | **收工必经**：`debug.sh --with-logs` + `--expect-tool`；**`pnpm flow` 不能替代** |

## L1 铁律

- **文档分工**：图规则 / factory API / 配置路径 / **术语** → 当前工作目录 `docs/`（**术语权威**：`docs/glossary.md`）；脚手架流程 / 平台登记 / **completion gate（完成闸门）** → 本技能 Part*（见 [README.md](../../../README.md) § 文档分工）。
- 图是契约；factory 优先；**Bespoke nodes** 不硬塞 factory；topology 单一权威看 `src/libs/topologies/`，可运行挂载看 `src/app/flows/`（示范：`scripts/scaffold/specs/`）；保护区不改。
- **用户可见大段 LLM 输出**（compose / aggregate / draft / 修订稿）→ **`createLlmStreamNode`**（`write` 读 `r.text`）；**禁止** `createLlmNode`（仅 invoke）。custom spec 用 `type: "llm-stream"`；**R-G009**。
- **平台能力（外部工具/Plugin/技能）** → **写图前**必须先 `dev-engineer-toolkit` 搜平台并 `add-tool`，再用 `get-config --key tools --full` 拉取已注册工具配置固化进 `spec.tools`（**禁止**手抄 schema）；固定管道节点 `params` 写工具名（`platform-tool`→`toolName`，集合→`tools`）；**禁止**为已登记能力手写 fetch/`tool()` 包装；**`add-tool` 后加载 `flow-debugger`**；收工须 `debug.sh --with-logs` + `--expect-tool` + 日志 `[结论]`；**禁止**用 `pnpm flow` 冒充端到端；**联网搜索较常见**，见 Part 3 § 联网搜索；禁止未搜平台就写外部能力、禁止以「用户待配置」代替登记（见 Part 3 § 平台能力登记、Part 0 completion gate）。
- **禁止写 `.agents/`**：内置能力写 `builtin/`（Part 6、Part 7）；平台能力走平台。
- **Subagent `AGENT.md`**：默认不写 `tools` / `model`；禁止平台 Plugin 登记名进 `tools`；联网由主 Agent 搜后写入 `task.description`；多岗串行 `task`（Part 6）。
- 有状态用 `createStatefulFlow`（**HITL durable stateful flow** 默认；`conversational: true` 为对话型；`dev-agent` **topology** `stateful-custom` 手写 run-loop 为例外，见 part2）。
- **系统提示词非空** — 用户输入提炼进 `systemPrompt`；Part 5 § 用户输入提炼；收工 Part 0 清单
- **收工必经 Part 4b** — Phase 3：`pnpm typecheck && pnpm test && pnpm graph` → `flow-debugger --with-logs`；**`pnpm flow` = 开发快检，≠ completion gate**；**禁止 `pnpm exec tsx`**；未跑 part4b / 无「flow-debugger 证据」小节禁止报 done。
