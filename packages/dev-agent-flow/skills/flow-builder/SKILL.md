---
name: flow-builder
description: "deepagents-flow-ts flow 开发（分层加载）：Part1–4 脚手架/编排/工具/验证；Part5 主Agent；Part6 子智能体；Part7 技能（均禁 .agents/ 直写）。LangGraph API 用 Context7。"
tags: [flow, scaffold, orchestration, tools, mcp, prompt, subagent, stategraph, hitl, debug, deepagents-flow-ts]
version: "2.2.8"
---

# Flow 开发（deepagents-flow-ts）

## 分层结构

```
flow-builder/
├── SKILL.md                 ← L1 入口（本文件）：路由 only
└── references/
    ├── part1-scaffold.md
    ├── part2-orchestration.md
    ├── part3-tools-config.md
    ├── part4-verify-debug.md
    ├── part5-prompt-design.md
    ├── part6-subagent.md
    └── part7-skill.md
```

**渐进加载**：只打开当前任务对应的一个 `references/part*.md`。

## When to Use

| 场景 | 读取 |
|------|------|
| 一句话需求 → 可跑 flow | [part1-scaffold.md](references/part1-scaffold.md) |
| 手写 StateGraph | [part2-orchestration.md](references/part2-orchestration.md) |
| 自写工具 / MCP / 变量 | [part3-tools-config.md](references/part3-tools-config.md) |
| 验证 / 跑不通 / HITL 排查 | [part4-verify-debug.md](references/part4-verify-debug.md) |
| 设计目标 Agent 系统提示词 / 开场白 | [part5-prompt-design.md](references/part5-prompt-design.md) |
| 创建/命名目标 Agent（通用智能体） | [part5-prompt-design.md](references/part5-prompt-design.md) + `dev-engineer-toolkit`；**禁止** `AGENT.md` |
| 子智能体 / subagent / 委派（平台或内置） | [part6-subagent.md](references/part6-subagent.md)；**禁止** `.agents/agents/` |
| 技能 / skill（平台或内置） | [part7-skill.md](references/part7-skill.md)；**禁止**本地写 `.agents/skills/` |

> LangGraph API → Context7：`resolve-library-id("langgraph")` → `query-docs`。

## 推荐路径

```
需求 → part1 命中？→ 生成 → part4
              └ custom？→ part1 custom → part4
                    └ part2 → part3? → part4
创建/命名主 Agent（通用智能体）？→ part5 → dev-engineer-toolkit 保存 → 改 config.agent.name（禁止 AGENT.md）
需 persona？→ part5 设计 → dev-engineer-toolkit 保存 → 填入 spec（part1）
要 subagent/委派？→ part6 → 平台 或 builtin/agents/（禁止 .agents/）
要 skill？→ part7 → 平台 或 builtin/skills/（禁止 .agents/）
```

## 目标项目文档

`README.md` · `docs/node-catalog.md` · `docs/node-kit.md` · `docs/flow-patterns.md`

## 关联技能

| 技能 | 何时用 |
|------|--------|
| `dev-engineer-toolkit` | 平台在线配置读写（systemPrompt / openingChatMsg / tools / skills）；part5 设计完后保存与回读 |

## L1 铁律

- 图是契约；factory 优先；`examples/` 只读；保护区不改。
- **禁止写 `.agents/`**：内置能力写 `builtin/`（Part 6、Part 7）；平台能力走平台。
- 有状态用 `createStatefulFlow`（`dev-agent` 拓扑 `stateful-custom` 手写 run-loop 为例外，见 part2）。
- 未跑通 part4 禁止报 done。
