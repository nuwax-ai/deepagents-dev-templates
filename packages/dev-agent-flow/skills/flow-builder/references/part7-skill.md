# Part 7：技能（Skill）— 平台或内置

> 所属：`flow-builder` L2-G。入口路由见 [SKILL.md](../SKILL.md)。

**开发 Agent 禁止**在 `.agents/skills/` 手写 `SKILL.md`。技能只有两条合法路径：

| 路径 | 何时用 | 怎么做 |
|------|--------|--------|
| **平台** | 用户要挂平台技能目录里的 skill | `dev-engineer-toolkit`：`search-skills.sh` → `add-tool.sh` 登记 → 需要时 `download-skill.sh` |
| **项目内置** | skill 随本仓库交付、模板自带 | `skills/builtin/<name>/SKILL.md`（YAML frontmatter `name`/`description` + 正文） |

## 开发 Agent 应做什么

1. 先 `search-skills.sh` 看平台是否已有
2. 有 → `add-tool.sh` 注册到 `<PLATFORM_CONFIG>.skills`，按需 `download-skill.sh`
3. 无且须随项目版本管理 → 写 `skills/builtin/<name>/SKILL.md`
4. 更新 `project.md` 摘要

## 禁止

- ❌ 创建 / 修改 `.agents/skills/<name>/SKILL.md`
- ❌ 只写本地 skill 不登记平台（平台技能场景）
- ❌ 报告中写「已在 .agents/skills 创建技能」

## checklist

- [ ] 未写入 `.agents/skills/`
- [ ] 平台技能已走 toolkit 登记 / 下载
- [ ] 内置 skill 仅在 `skills/builtin/`
