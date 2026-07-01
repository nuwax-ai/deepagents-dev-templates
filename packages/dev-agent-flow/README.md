# 开发 Agent 配置（Flow 版）

## 概述

本包包含 **开发 Agent（Flow 版）** 的系统提示词和 Skills 配置。开发 Agent 运行在云端开发环境，职责是帮开发者基于 `deepagents-flow-ts` 工作流编排模板创建场景 Agent。

与 `dev-agent`（面向 `deepagents-app-ts`，自由 tool loop）不同，本包面向 **`deepagents-flow-ts`** —— Agent 按 **preset topology**（预先设计的 node + edge 图）跑 LangGraph，而非自由 tool loop。

**一句话 → 可跑 Agent**：加载 `flow-builder` **Part 1** 脚手架（**9 topologies** = **8 presets** + `custom` spec → 生成薄封装 + 自动注册 + typecheck/graph 自验），命中 preset topology 优先于 Part 2 手写。

## 与 dev-agent 的关系

| | dev-agent | dev-agent-flow |
|--|-----------|----------------|
| 面向模板 | `deepagents-app-ts` | `deepagents-flow-ts` |
| 运行范式 | 自由 tool loop（`createDeepAgent()`） | **preset topology**（LangGraph node + edge 图） |
| 核心抽象 | 工具注册（`createTools()`） | 图编排（graph + nodes + **surface seam（接入层）**） |
| 目标 Agent 提示词基准 | `target-agent.base.md` | `flow.base.md`（经 `dev-engineer-toolkit` 同步 `<PLATFORM_CONFIG>`，定义见 `system-prompt.md`） |
| 配置文件 | `app-agent.config.json` | `flow-agent.config.json` |
| 语言 | TS + Python | 仅 TS |

## 文件结构

本包（`dev-agent-flow`）与 `packages/deepagents-flow-ts` **模板源码独立**：技能由**开发 Agent** 在开发环境侧加载，**不随 Nuwax 平台压缩包下发**，也不会出现在模板仓库目录树中。

## 文档分工（必读）

| 层级 | 位置 | 职责 |
|------|------|------|
| **模板本体** | `deepagents-flow-ts/` 内 `README.md`、`docs/*`（含 **`docs/glossary.md` 术语表**）、`config/`、`prompts/` | 描述**本工作目录**内的能力、配置路径、图编排规则（`flow-graph-rules.md` R-G*）、排错索引；**不**承载开发 Agent 工作流 |
| **开发 Agent 引导** | 本包 `system-prompt.md`（**规则/约束**）+ `skills/flow-builder/`（**实现步骤**）+ `skills/dev-engineer-toolkit/` | `system-prompt` 定铁律；`flow-builder` Part 0–7 承载逐步流程（脚手架、编排、提示词提炼、completion gate 等） |

**单一权威原则**：图怎么写、规则 ID、factory API → 读目标项目 `docs/`；开发流程、平台登记、**completion gate（完成闸门）** → 读本包 `flow-builder` Part*。技能内 `references/flow-graph-rules-pointer.md` 仅为**路由页**，详表永远在目标项目 `docs/flow-graph-rules.md`。**术语**（durable stateful flow / topology / 护栏分语境 等）统一以目标项目 `docs/glossary.md` 为准。

```
packages/dev-agent-flow/          # 开发 Agent 提示词 + 技能（非模板一部分）
├── system-prompt.md
├── user-prompt.md
└── skills/
    ├── flow-builder/             # flow 脚手架 / 编排 / 提示词设计
    └── dev-engineer-toolkit/     # `<PLATFORM_CONFIG>` 读写与能力搜索注册脚本
```

> **分工**：`system-prompt.md` = 规则与约束；`flow-builder/references/part0-workflow.md` = Phase 0–4 总流程；`part5-prompt-design.md` = 提示词提炼与平台同步；`dev-engineer-toolkit` = 配置读写脚本。

## 平台绑定（推荐 2 个 skill）

| 保留 | 职责 |
|------|------|
| `flow-builder` | Part 0 总流程；Part 1–4 脚手架/编排/工具/验证；Part 5 系统提示词；Part 6–7 子智能体/技能 |
| `dev-engineer-toolkit` | `<PLATFORM_CONFIG>` 读写；工具/技能搜索注册与下载 |

已并入 `flow-builder`、可解绑：`flow-scaffold`、`flow-tools-config`、`flow-prompt-designer`。

## 集成方式

### nuwax-file-server 配置

| 源文件 | 目标目录 | 说明 |
|--------|---------|------|
| `system-prompt.md` | `.claude/CLAUDE.md` 或 `.agents/system.md` | 系统提示词 |
| `skills/*/SKILL.md` | `.claude/commands/` 或 `.agents/skills/` | 技能文件 |

### 格式适配

| 平台 | 配置目录 |
|------|---------|
| Claude Code | `.claude/` |
| Codex | `.codex/` |
| OpenCode | `.opencode/` |
| DeepAgents | `.agents/` |

## 版本管理

- 系统提示词和 Skills 与模板项目**独立版本管理**
- 修改后更新 `package.json` 中的 `version` 字段
