# 开发 Agent 配置（Flow 版）

## 概述

本包包含 **开发 Agent（Flow 版）** 的系统提示词和 Skills 配置。开发 Agent 运行在 nuwax 云端，职责是帮开发者基于 `deepagents-flow-ts` 工作流编排模板创建场景 Agent。

与 `dev-agent`（面向 `deepagents-app-ts`，自由 tool loop）不同，本包面向 **`deepagents-flow-ts`** —— Agent 按显式 LangGraph 工作流图（节点 + 边）运行，而非自由工具循环。技能体系全面围绕「节点图编排」思维设计。

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
├── system-prompt.md                          # 系统提示词（XML 标签分区）
├── skills/
│   ├── flow-template-init/SKILL.md                # 模板检测：分层架构、import 方向、示例对照表
│   ├── flow-orchestration/SKILL.md           # 编排核心：StateGraph/节点/边/Send/HITL/createStatefulFlow/checkpoint
│   ├── flow-creator/SKILL.md                 # 创建新 flow：State->节点->graph->执行器->surface 挂接
│   ├── flow-framework/SKILL.md               # 框架 API + ACP：分层架构/FlowRuntime/surface seam/bootstrapFlowAcp
│   ├── flow-tool-creator/SKILL.md                 # 工具开发：tool()+Zod/无状态vs工厂/注册 createFlowTools
│   ├── flow-config-setup/SKILL.md                 # 配置管理：MCP 服务器/合并策略/agent_variable 密钥
│   ├── flow-prompt-designer/SKILL.md              # 基于 flow.base.md 设计提示词
│   ├── flow-skill-creator/SKILL.md                # 技能创建
│   └── flow-verify-and-test/SKILL.md             # 验证流程：build->test(分层守卫)->ACP冒烟->graph
└── README.md                                 # 本文件
```

## 集成方式

### nuwax-file-server 配置

nuwax-file-server 在初始化 Agent 项目时，将本包内容写入目标项目的以下目录：

| 源文件 | 目标目录 | 说明 |
|--------|---------|------|
| `system-prompt.md` | `.claude/CLAUDE.md` 或 `.agents/system.md` | 系统提示词 |
| `skills/*/SKILL.md` | `.claude/commands/` 或 `.agents/skills/` | 技能文件 |

### 格式适配

不同 Agent 平台的配置格式不同，由 nuwax-file-server 负责转换：

| 平台 | 配置目录 | 格式 |
|------|---------|------|
| Claude Code | `.claude/` | CLAUDE.md + commands/ |
| Codex | `.codex/` | codex 配置格式 |
| OpenCode | `.opencode/` | opencode 配置格式 |
| DeepAgents | `.agents/` | agents 配置格式 |

## 版本管理

- 系统提示词和 Skills 与模板项目**独立版本管理**
- 修改后更新 `package.json` 中的 `version` 字段
- nuwax-file-server 支持模板版本更新替换
