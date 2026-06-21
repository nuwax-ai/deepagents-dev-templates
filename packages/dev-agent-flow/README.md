# 开发 Agent 配置（Flow 版）

## 概述

本包包含 **开发 Agent（Flow 版）** 的系统提示词和 Skills 配置。开发 Agent 运行在 nuwax 云端，职责是帮开发者基于 `deepagents-flow-ts` 工作流编排模板创建场景 Agent。

与 `dev-agent`（面向 `deepagents-app-ts`，自由 tool loop）不同，本包面向 **`deepagents-flow-ts`** —— Agent 按显式 LangGraph 工作流图（节点 + 边）运行，而非自由工具循环。技能体系全面围绕「节点图编排」思维设计。

**一句话 → 可跑 Agent 的首选路径**：`flow-scaffold` 技能把常见需求映射到 7 个预置拓扑（客服 / 审阅 / 规划 / 调研 / 检索 / 研究 / 综合助手），写一个 spec 即生成可跑薄封装 flow + 自动注册 + 自带 typecheck/graph 验证。命中拓扑优先用它（积木式，对标 Coze），bespoke 图才走 `flow-builder` 手写。

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
├── system-prompt.md              # 系统提示词（XML 分区；含 <SCAFFOLD_FIRST> 脚手架优先 + <COMPLETION_GATE> 完成闸门 + <CONTEXT_DISCIPLINE> 上下文纪律）
├── skills/
│   ├── flow-scaffold/SKILL.md         # ⭐ 一句话→flow 首选：7 拓扑积木目录（react-tools/…/dev-agent）+ spec → 生成薄封装 + 自动注册 + typecheck/graph 自验；优先于从零手写
│   ├── flow-builder/SKILL.md          # 编排+创建+验证：State/节点 factory/graph 连线/Send/HITL/createStatefulFlow；Step 7=验证命令+.logs/ 六步排查（强制）
│   ├── flow-tools-config/SKILL.md     # 工具与配置：src/libs/tools/ 用 tool()+Zod、注册 createFlowTools、MCP 服务器/合并策略、agent_variable 密钥
│   ├── agent-dev-config/SKILL.md      # 平台接入：搜索/添加 Plugin·Workflow·Knowledge 到 dev Agent 配置、按 schema 实现工具、保存系统提示词/开场白
│   └── flow-prompt-designer/SKILL.md  # 目标 Agent 提示词设计：七要素骨架 + 场景 few-shot 模板（客服/内容/数据分析/任务工具型）+ 质量自检，经 agent-dev-config 保存并回读
└── README.md                     # 本文件
```

> **提示词设计**由 `flow-prompt-designer`（七要素骨架 + 客服/内容生成/数据分析/任务工具型 场景 few-shot 模板 + 质量自检）承担：设计好后经 `agent-dev-config` 保存到平台并回读校验。运行时范式基准见 `deepagents-flow-ts` 的 `prompts/flow.base.md`。

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
