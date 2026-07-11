# 开发 Agent 配置（Flow 版）

## 概述

本包包含 **开发 Agent（Flow 版）** 的系统提示词和 Skills 配置。开发 Agent 运行在云端开发环境，职责是帮开发者基于 `nuwax-flow-ts` 工作流编排模板创建场景 Agent。

与 `dev-agent`（面向 `deepagents-app-ts`，自由 tool loop）不同，本包面向 **`nuwax-flow-ts`** —— Agent 按 **LangGraph node + edge 图**跑（框架内置**默认 ReAct**，可手写扩展），而非自由 tool loop。

**交付路径**：先判定 **default 是否够用**（权威：目标项目 `docs/examples.md` § 先判定）。说不清「为什么不够」→ `flow.active: "default"` + 平台能力登记 + systemPrompt，**不写图**（已含 ReAct + 多轮记忆）。**必须**固定阶段顺序、Send 并行/多源聚合/条件重试、或跨 turn HITL 时，才加载 `flow-builder` Part 1/Part 2 手写 `src/app/graph.ts`（框架无脚手架、无 `src/libs/topologies/`、注册表仅 `default`）。**勿把改图当菜单推销**；命中能力门槛再升级。

## 与 dev-agent 的关系

| | dev-agent | dev-agent-flow |
|--|-----------|----------------|
| 面向模板 | `deepagents-app-ts` | `nuwax-flow-ts` |
| 运行范式 | 自由 tool loop（`createDeepAgent()`） | **LangGraph node + edge 图**（默认 ReAct + 手写扩展） |
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
| **开发 Agent 引导** | 本包 `system-prompt.md`（**规则/约束**）+ `skills/flow-builder/`（**实现步骤**）+ `skills/dev-engineer-toolkit/` | `system-prompt` 定铁律；`flow-builder` Part 0–7 承载逐步流程（图选型落地、编排、提示词提炼、completion gate 等） |
| **能力与工具对照** | [../deepagents-flow-ts/docs/capabilities.md](../deepagents-flow-ts/docs/capabilities.md) | 平台工具 schema 来源、运行时装配、节点工具引用与 allTools 合并规则 |

**单一权威原则**：图怎么写、规则 ID、factory API → 读目标项目 `docs/`；开发流程、平台登记、**completion gate（完成闸门）** → 读本包 `flow-builder` Part*。技能内 `references/flow-graph-rules-pointer.md` 仅为**路由页**，详表永远在目标项目 `docs/flow-graph-rules.md`。**术语**（聊天助手型 / 固定流程型、HITL 人审编排、flow profile、`flow.active`、durable stateful flow / topology / 护栏分语境 等）统一以目标项目 `docs/glossary.md` 为准。

**CLI 约定**（与模板 `package.json` scripts 对齐）：profile / graph / capabilities 用 `pnpm flows` / `pnpm graph` / `pnpm capabilities`，**禁止 `pnpm exec tsx`**（pnpm 10/11 沙箱预检问题见目标项目 `docs/troubleshooting.md`）。

```
packages/dev-agent-flow/          # 开发 Agent 提示词 + 技能（非模板一部分）
├── system-prompt.md
├── user-prompt.md
└── skills/
    ├── flow-builder/             # flow 图选型落地 / 编排 / 提示词设计
    └── dev-engineer-toolkit/     # `<PLATFORM_CONFIG>` 读写与能力搜索注册脚本
```

> **分工**：`system-prompt.md` = 规则与约束；`flow-builder/references/part0-workflow.md` = Phase 0–4 总流程；`part5-prompt-design.md` = 提示词提炼与平台同步；`dev-engineer-toolkit` = 配置读写脚本。

## 平台绑定（推荐 2 个 skill）

| 保留 | 职责 |
|------|------|
| `flow-builder` | Part 0 总流程；Part 1–4 图选型落地/编排/工具/验证；Part 5 系统提示词；Part 6–7 子智能体/技能 |
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

## 上下文预算（三层渐进披露）

开发 Agent 上下文按层加载，避免一次性注入全部文档：

| 层 | 内容 | 体量（约） | 加载时机 |
|----|------|-----------|----------|
| **L0** | `system-prompt.md` + `user-prompt.md` | ~150 行 | 每次会话固定注入 |
| **L1** | `skills/*/SKILL.md` | 每 skill ~80–120 行 | 按需 `load_skill` / 平台 skill 机制 |
| **L2** | `skills/*/references/*.md` | 按 Part 单文件 | `Read` 或 `load_skill(name, part=…)` |

**原则**：
- `system-prompt.md` 只保留铁律与边界；实现步骤在 `flow-builder` Part*
- `dev-engineer-toolkit/SKILL.md` 保持完整内联文档（稳定优先，不经 L1 瘦身）；可选深读 `references/api-docs.md`
- `flow-builder` 每次只开一个 `references/part*.md`
- 图规则 / factory API 权威在目标项目 `docs/`（不复制到本包）
- **技能独立部署**：每个 `skills/<name>/` 自包含（`SKILL.md` + `references/` + `scripts/`），**禁止**跨 skill 共享目录或 `source` 外部路径

**典型会话估算**（瘦身后，不含完整 toolkit）：启动 ~150 行 + flow-builder(92) + 单 Part(~150) ≈ **~390 行**；若加载 `dev-engineer-toolkit` 全量 SKILL 另 +~528 行。
