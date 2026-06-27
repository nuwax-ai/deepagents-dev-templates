# Part 7：技能（Skill）— 平台或内置

> 所属：`flow-builder` L2-G。入口路由见 [SKILL.md](../SKILL.md)。

**禁止**在 `.agents/skills/` 手写 `SKILL.md`。合法路径：

| 路径 | 怎么做 |
|------|--------|
| **平台** | `search-skills.sh` → `add-tool.sh` → 按需 `download-skill.sh` |
| **项目内置** | `builtin/skills/<name>/SKILL.md`（`agentsDirectories` 含 `./builtin`） |

## 开发 Agent 应做什么

1. 先 `search-skills.sh`
2. 有 → toolkit 登记 / 下载
3. 无且须随仓库交付 → `builtin/skills/<name>/SKILL.md`
4. 更新 `project.md`

## 禁止

- ❌ `.agents/skills/<name>/SKILL.md`
- ❌ 报告中写「已在 .agents/skills 创建技能」

## checklist

- [ ] 未写入 `.agents/skills/`
- [ ] 内置 skill 在 `builtin/skills/`
