# 交付配置 · 迭代版本清单

编号 **`iter-X.Y.Z`**（与 `package.json` npm 版本解耦）。  
新条目**置顶**。每次改 [`../orchestration/`](../orchestration/)（及按需的 `deepagents-flow-ts`）后升号并追加。

分工：[`ITERATION.md`](ITERATION.md) = 当轮过程；[`ALIGNMENT.md`](ALIGNMENT.md) = 功能/规则对齐基线；本文件 = **回朔清单**；[`scoreboard.md`](scoreboard.md) = 跑分。

## 条目模板

```markdown
## iter-X.Y.Z — YYYY-MM-DD

- **摘要**：一句话
- **交付变更**：
  - orchestration/system-prompt.md — …
  - orchestration/skills/… — …
  - packages/deepagents-flow-ts/… — …（仅对齐需要时）
- **约束/规则对齐要点**：
- **验证**：`pnpm iteration:static` …
- **回朔**：
  - git：`git checkout <tag|commit> -- packages/dev-agent-flow/orchestration`
  - 模板若有改：`git checkout <tag|commit> -- packages/deepagents-flow-ts/<paths>`
- **后台**：已人工同步编排页？是 / 否
```

---

## iter-0.2.0 — 2026-07-12

- **摘要**：规则对齐 — ask-question 双口径拆清、download-skill 禁区统一、MCP_USAGE 进 manifest；明确模板可按需改
- **交付变更**：
  - `orchestration/system-prompt.md` — `<MCP_USAGE>` / 速览 / `<OUTPUT_FORMAT>` / `<PLATFORM_CONFIG>` download-skill 口径
  - `orchestration/agent.manifest.json` — `requiredSections` 增加 `MCP_USAGE`
  - `orchestration/skills/dev-engineer-toolkit/SKILL.md` — §5 download-skill 与 L0/Part7 对齐
  - `iteration/` README、包 README、`ALIGNMENT.md` — 模板「默认不动、对齐可改」
- **模板变更**：无（核对 flow-ts 平台能力双路径已与 Part 3 一致）
- **约束/规则对齐要点**：见 [`ALIGNMENT.md`](ALIGNMENT.md)
- **验证**：`pnpm iteration:static` 通过
- **回朔**：`git checkout <commit> -- packages/dev-agent-flow/orchestration packages/dev-agent-flow/iteration`
- **后台**：否（待人工同步 system-prompt / skills）

---

## iter-0.1.0 — 2026-07-12

- **摘要**：落地 `orchestration/` + `iteration/` 双层；L0 MCP 用法收口；静态门禁与期望清单就绪
- **交付变更**：
  - `orchestration/system-prompt.md` — 新增 `<MCP_USAGE>`（Context7 / 宿主 ask-question，开发 Agent 自用）
  - `orchestration/user-prompt.md` — 迁入 orchestration（内容未改）
  - `orchestration/skills/*` — 三技能整体迁入 orchestration
  - `orchestration/agent.manifest.json` (+ schema) — prompts/skills/MCP 用法期望清单
- **约束/规则对齐要点**：
  - 交付物人工同步编排后台；`iteration/` 不下发
  - MCP 只调用法：context7 绑定两工具；ask-question 不要求编排页 type=Mcp
  - 不以目标业务 Agent E2E 作本迭代层主门禁
- **验证**：`pnpm iteration:static` 通过（sample fixture drift）
- **回朔**：
  - 本基线为目录重构后的第一版；回朔到重构前需还原包根平铺布局
  - 之后版本：`git checkout <commit> -- packages/dev-agent-flow/orchestration`
- **后台**：否（待人工同步）
