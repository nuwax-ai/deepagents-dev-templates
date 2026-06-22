# 开发 Agent 配置（Flow 版）

## 概述

本包包含 **开发 Agent（Flow 版）** 的系统提示词和 Skills 配置。开发 Agent 运行在 nuwax 云端，职责是帮开发者基于 `deepagents-flow-ts` 工作流编排模板创建场景 Agent。

与 `dev-agent`（面向 `deepagents-app-ts`，自由 tool loop）不同，本包面向 **`deepagents-flow-ts`** —— Agent 按显式 LangGraph 工作流图（节点 + 边）运行，而非自由工具循环。

**一句话 → 可跑 Agent**：加载 `flow-builder` **Part 1** 脚手架（8 拓扑 + custom spec → 生成薄封装 + 自动注册 + typecheck/graph 自验），命中拓扑优先于 Part 2 手写。

## 与 dev-agent 的关系

| | dev-agent | dev-agent-flow |
|--|-----------|----------------|
| 面向模板 | `deepagents-app-ts` | `deepagents-flow-ts` |
| 运行范式 | 自由 tool loop（`createDeepAgent()`） | 显式 StateGraph 工作流图 |
| 核心抽象 | 工具注册（`createTools()`） | 图编排（graph + nodes + surface seam） |
| 提示词基准 | `target-agent.base.md` | `flow.base.md` |
| 配置文件 | `app-agent.config.json` | `flow-agent.config.json` |
| 语言 | TS + Python | 仅 TS |

## 文件结构

```
packages/dev-agent-flow/
├── system-prompt.md              # 系统提示词（XML 分区）
├── user-prompt.md                # 用户侧默认指令
├── skills/
│   ├── flow-builder/
│   │   ├── SKILL.md                  # L1 入口：路由 + 端到端路径
│   │   └── references/               # L2 分层详情（按需加载）
│   │       ├── part1-scaffold.md
│   │       ├── part2-orchestration.md
│   │       ├── part3-tools-config.md
│   │       ├── part4-verify-debug.md
│   │       └── part5-prompt-design.md
│   └── agent-dev-config/           # 平台 dev 配置（tools / 提示词保存）
│       ├── SKILL.md
│       ├── scripts/
│       └── references/
└── README.md
```

> 提示词设计在 `flow-builder/references/part5-prompt-design.md`，保存走 `agent-dev-config`。

## 平台绑定（推荐 2 个 skill）

| 保留 | 职责 |
|------|------|
| `flow-builder` | 脚手架、编排、工具、验证、**提示词设计**（L1 + references） |
| `agent-dev-config` | 平台工具配置、提示词/开场白保存 |

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
