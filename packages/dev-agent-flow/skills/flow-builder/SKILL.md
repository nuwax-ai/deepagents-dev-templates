---
name: flow-builder
description: "deepagents-flow-ts flow 开发（分层加载）：Part1 脚手架 / Part2 编排 / Part3 工具MCP / Part4 验证调试 / Part5 目标Agent提示词设计。保存提示词走 agent-dev-config。LangGraph API 用 Context7。"
tags: [flow, scaffold, orchestration, tools, mcp, prompt, stategraph, hitl, debug, deepagents-flow-ts]
version: "2.2.0"
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
    └── part5-prompt-design.md
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

> LangGraph API → Context7：`resolve-library-id("langgraph")` → `query-docs`。

## 推荐路径

```
需求 → part1 命中？→ 生成 → part4
              └ custom？→ part1 custom → part4
                    └ part2 → part3? → part4
需 persona？→ part5 设计 → agent-dev-config 保存 → 填入 spec（part1）
```

## 目标项目文档

`README.md` · `docs/node-catalog.md` · `docs/node-kit.md` · `docs/flow-patterns.md`

## 关联技能

| 技能 | 何时用 |
|------|--------|
| `agent-dev-config` | 平台工具搜索/添加；**提示词/开场白保存**（part5 设计完后） |

## L1 铁律

- 图是契约；factory 优先；`examples/` 只读；保护区不改。
- 有状态用 `createStatefulFlow`。
- 未跑通 part4 禁止报 done。
