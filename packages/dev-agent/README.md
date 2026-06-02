# 开发 Agent 配置

## 概述

本包包含 **开发 Agent** 的系统提示词和 Skills 配置。开发 Agent 运行在 nuwax 云端，职责是帮开发者基于 `deepagents-dev-templates` 模板创建场景 Agent。

## 文件结构

```
packages/dev-agent/
├── system-prompt.md              # 系统提示词（~200行，XML 标签分区）
├── skills/
│   ├── template-init/SKILL.md    # 模板结构检测
│   ├── tool-creator/SKILL.md     # 工具开发流程
│   ├── skill-creator/SKILL.md    # 技能开发流程
│   ├── prompt-designer/SKILL.md  # 提示词设计流程
│   ├── mcp-setup/SKILL.md        # MCP 集成配置
│   ├── variable-setup/SKILL.md   # 变量管理
│   └── verify-and-test/SKILL.md  # 验证测试流程
└── README.md                     # 本文件
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
