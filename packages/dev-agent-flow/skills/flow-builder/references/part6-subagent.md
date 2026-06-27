# Part 6：子智能体（Subagent）— 平台或内置

> 所属：`flow-builder` L2-F。入口路由见 [SKILL.md](../SKILL.md)。

**禁止**写 `.agents/agents/`。子智能体合法路径（与 [part7-skill.md](part7-skill.md) 对称）：

| 路径 | 何时用 | 怎么做 |
|------|--------|--------|
| **平台** | 用户要挂平台编排的子智能体 | 引导用户在平台 UI 添加 |
| **项目内置** | subagent 随本仓库交付 | `agents/builtin/<name>/AGENT.md`（`config.subagents.directories`） |

## 开发 Agent 应做什么

1. **不要**创建 `.agents/agents/`
2. 平台需求 → 引导平台 UI
3. 须随项目版本管理 → 写 `agents/builtin/<name>/AGENT.md`
4. 平台已有 subagent 时，可在 Part 5 `systemPrompt` 补充 `task({ subagent_type, description })` 指引
5. 更新 `project.md`

## 禁止

- ❌ `.agents/agents/<name>/AGENT.md`
- ❌ 把「创建通用智能体，名字叫 X」建成 subagent
- ❌ 报告中写「已在 .agents/agents 创建子智能体」

## AGENT.md 模板（仅 `agents/builtin/`）

```markdown
---
name: researcher
description: "研究助手"
---
你是研究专家。根据 task 描述独立调研，返回结构化结论。
```

## checklist

- [ ] 未写入 `.agents/agents/`
- [ ] 内置 subagent 仅在 `agents/builtin/`
- [ ] 主 Agent 改动走 Part 5 + `<SESSION_CLOSE>`
