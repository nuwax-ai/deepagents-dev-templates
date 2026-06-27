# Part 6：子智能体（Subagent）— 平台或内置

> 所属：`flow-builder` L2-F。入口路由见 [SKILL.md](../SKILL.md)。

**禁止**写 `.agents/agents/`。合法路径：

| 路径 | 怎么做 |
|------|--------|
| **平台** | 引导用户在平台 UI 添加 |
| **项目内置** | `builtin/agents/<name>/AGENT.md`（与 `builtin/skills/` 同属 `agentsDirectories: ["./builtin", …]`） |

## 开发 Agent 应做什么

1. **不要**写 `.agents/agents/`
2. 平台需求 → 引导平台 UI
3. 须随仓库交付 → `builtin/agents/<name>/AGENT.md`
4. 更新 `project.md`

## AGENT.md 模板

```markdown
---
name: researcher
description: "研究助手"
---
你是研究专家。根据 task 描述独立调研，返回结构化结论。
```

## checklist

- [ ] 未写入 `.agents/agents/`
- [ ] 内置 subagent 在 `builtin/agents/`
