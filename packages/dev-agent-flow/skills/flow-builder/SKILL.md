---
name: flow-builder
description: "deepagents-flow-ts flow 开发（分层加载）：Part0 总流程；Part1–4 脚手架/编排/工具/验证；Part5 系统提示词；Part6–7 子智能体/技能。LangGraph API 用 Context7。"
tags: [flow, scaffold, orchestration, tools, mcp, prompt, subagent, stategraph, hitl, debug, deepagents-flow-ts]
version: "2.8.0"
---

# Flow 开发（deepagents-flow-ts）

## 分层结构

```
flow-builder/
├── SKILL.md                 ← L1 入口（本文件）：路由 only
└── references/
    ├── part0-workflow.md          ← 端到端流程 / completion gate 清单 / Context7 / 内置工具
    ├── part1-scaffold.md
    ├── part2-orchestration.md
    ├── part3-tools-config.md
    ├── part4a-verify-debug.md
    ├── part4b-smoke-acp.md
    ├── flow-graph-rules-pointer.md
    ├── part5-prompt-design.md
    ├── part6-subagent.md
    └── part7-skill.md
```

**渐进加载**：只打开当前任务对应的一个 `references/part*.md`。

## When to Use

| 场景 | 读取 |
|------|------|
| **会话启动 / Phase 0–4 总流程 / 收尾清单** | **[part0-workflow.md](references/part0-workflow.md)** |
| 一句话需求 → 可跑 flow | [part1-scaffold.md](references/part1-scaffold.md) |
| 手写 StateGraph | [part2-orchestration.md](references/part2-orchestration.md) + [flow-graph-rules-pointer.md](references/flow-graph-rules-pointer.md) |
| 自写工具 / MCP / 变量 | [part3-tools-config.md](references/part3-tools-config.md) |
| 验证 / 跑不通 / HITL 排查 | [part4a-verify-debug.md](references/part4a-verify-debug.md) |
| **`pnpm smoke` / rcoder-cli / 模型 env / Invalid model** | **[part4b-smoke-acp.md](references/part4b-smoke-acp.md)**（必读） |
| `parseJson` / `LLM 未返回 JSON` / 图编排硬规则 | [flow-graph-rules-pointer.md](references/flow-graph-rules-pointer.md) → 目标项目 `docs/flow-graph-rules.md`（R-G001+） |
| **无流式 / 整段一次性输出 / 用户可见 LLM 文本** | **[part2-orchestration.md](references/part2-orchestration.md) § 流式输出** + **R-G009** |
| **联网 / 网页搜索 / 实时资讯 / 多源调研** | **[part3-tools-config.md](references/part3-tools-config.md) § 联网搜索** + `dev-engineer-toolkit` |
| 工具审批 / `Permission denied` / `permissions` 配置 | [part3-tools-config.md](references/part3-tools-config.md) + [part4a-verify-debug.md](references/part4a-verify-debug.md) |
| 设计目标 Agent 提示词 / **用户输入提炼** / 平台同步 | **[part5-prompt-design.md](references/part5-prompt-design.md)** |
| 创建/命名目标 Agent（通用智能体） | [part5-prompt-design.md](references/part5-prompt-design.md) + `dev-engineer-toolkit`；**禁止** `AGENT.md` |
| 子智能体 / subagent / 委派（平台或内置） | [part6-subagent.md](references/part6-subagent.md)；**禁止** `.agents/agents/` |
| 技能 / skill（平台或内置） | [part7-skill.md](references/part7-skill.md)；**禁止**本地写 `.agents/skills/` |

> LangGraph API → Context7：见 [part0-workflow.md](references/part0-workflow.md) § Context7。

## 推荐路径

```
会话启动 → part0（依赖 / 系统提示词基线 / 读 docs）
需求 → part1 命中？→ 生成 → part4a + part4b-smoke-acp
              └ custom？→ part1 custom → part4a + part4b
                    └ part2 → part3? → part4a
系统提示词 / 用户输入提炼？→ part5（含平台同步）→ dev-engineer-toolkit
收工清单 → part0 § completion gate 收尾清单 + part4a
```

## 目标项目文档（模板自洽，开发 Agent 按需读取）

下列路径均在**目标项目** `deepagents-flow-ts` 工作目录内；描述模板能力与配置，**不**包含开发 Agent 工作流（工作流见本技能 Part*）：

`README.md` · `docs/glossary.md` · `docs/flow-graph-rules.md` · `docs/node-catalog.md` · `docs/node-kit.md` · `docs/flow-patterns.md` · `docs/troubleshooting.md` · `docs/capabilities.md` · `scripts/README.md`

## 关联技能

| 技能 | 何时用 |
|------|--------|
| `dev-engineer-toolkit` | 平台在线配置读写（systemPrompt / openingChatMsg / tools / skills）；part5 设计完后保存与回读 |

## L1 铁律

- **文档分工**：图规则 / factory API / 配置路径 / **术语** → 目标项目 `docs/`（**术语权威**：`docs/glossary.md`）；脚手架流程 / 平台登记 / **completion gate（完成闸门）** → 本技能 Part*（见 [README.md](../../../README.md) § 文档分工）。
- 图是契约；factory 优先；**Bespoke nodes** 不硬塞 factory；`examples/` 只读；保护区不改。
- **用户可见大段 LLM 输出**（compose / aggregate / draft / 修订稿）→ **`createLlmStreamNode`**（`write` 读 `r.text`）；**禁止** `createLlmNode`（仅 invoke，ACP 整段兜底）。custom spec 用 `type: "llm-stream"`；**R-G009**。
- **联网/实时搜索** → 必须先 `dev-engineer-toolkit` 搜平台 Plugin/Knowledge/`mcpConfigs` 并注册；**禁止**把内置 `grep`/`search` 当联网、禁止未搜平台就 bash/curl/自写搜索 API（见 Part 3 § 联网搜索、`<WEB_SEARCH>`）。
- **禁止写 `.agents/`**：内置能力写 `builtin/`（Part 6、Part 7）；平台能力走平台。
- 有状态用 `createStatefulFlow`（**HITL durable stateful flow** 默认；`conversational: true` 为对话型；`dev-agent` **topology** `stateful-custom` 手写 run-loop 为例外，见 part2）。
- **系统提示词非空** — 用户输入提炼进 `systemPrompt`；Part 5 § 用户输入提炼；收工 Part 0 清单
- 未跑通 part4 禁止报 done。
