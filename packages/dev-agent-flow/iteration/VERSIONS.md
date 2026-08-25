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

## iter-0.4.0 — 2026-08-25

- **摘要**：非 ReAct 开发模式收敛删除 — 仅保留 default ReAct 路径：运行时 `flow.active` 非 default 直接报错（不回落）；手写图 / 固定管道 / HITL 图 / Send 并行指引与资料删除，相关需求一律以 default ReAct + 平台工具 + systemPrompt 落地（不向用户展开实现模式细节）
- **交付变更**：
  - `orchestration/system-prompt.md` — `<DEVELOPMENT_CONSTRAINTS>` 第 8 条（禁止手写图 / 固定管道 / HITL 图 / Send 并行 / 新建切换 flow）；`<MCP_USAGE>` / `<OUTPUT_FORMAT>` / `<SESSION_CLOSE>` 同步收敛
  - `orchestration/user-prompt.md` — 第 2 步改为一律 default ReAct 路径
  - `orchestration/skills/flow-builder/SKILL.md` — 删除 part1/part2 路由，When to Use / 推荐路径 / L1 约束收敛为 default ReAct 唯一路径（版本 3.5.1 → 3.6.0）
  - `orchestration/skills/flow-builder/references/` — 删除 `part1-fixed-flow.md`、`part2-orchestration.md`；part0 / part3 / part4a / part4b / part5 / flow-graph-rules-pointer 同步改写
  - `iteration/checks/check-document-ownership.py` — pre-code gate 标记 `写图前` → `施工前`
- **模板变更**（`packages/deepagents-flow-ts`，2.1.7 → 2.2.0）：
  - `src/app/flows/index.ts` — `resolveFlow` 未注册直接抛错（不回落）；删除 `unknownActivePolicy`
  - `src/runtime/config/config-schema.ts` / `src/index.ts` / `config/flow-agent.config.json` — 同步删除 `unknownActivePolicy`
  - 删除 `docs/flow-patterns.md`、`examples/` 演示目录；`docs/*` 与 `README.md` 收敛为 ReAct-only（不留"已屏蔽"标注）
  - `tests/flow-registry.test.ts` / `tests/flow-selection.test.ts` — 抛错断言
- **约束/规则对齐要点**：注册表仅 `default`；`flow.active` 其他值启动报错；固定阶段 / 人审确认 / 多源汇总以 systemPrompt + 工具承接；平台工具统一并入 `allTools` 供默认 ReAct `bindTools`
- **验证**：模板 `pnpm typecheck && pnpm test && pnpm graph` 全过（391 tests）；`pnpm iteration:static` 全绿
- **回朔**：`git checkout 92c51bfe -- packages/dev-agent-flow/orchestration packages/dev-agent-flow/iteration packages/deepagents-flow-ts`
- **后台**：否（待人工同步 system-prompt / user-prompt / flow-builder）

---

## iter-0.2.2 — 2026-07-12

- **摘要**：勿误报鉴权 — 平台工具最终有产出（`done>0`，个别 failed 被 ReAct 重试消化）时，`debug.sh` 断言未命中 / HITL 失败禁止写成 Authorization 待办。收敛到 flow-debugger 单一权威 + L0 一句铁律 + analyze-logs 自动提示
- **交付变更**：
  - `orchestration/system-prompt.md` — `<SESSION_CLOSE>` 第 8 条一句铁律（工具最终有产出就别误报鉴权，指针 → flow-debugger）
  - `orchestration/skills/flow-debugger/references/outcome-rules.md` — § 勿误报鉴权（判据 + 场景表，单一权威）
  - `orchestration/skills/flow-debugger/SKILL.md` — 一句日志佐证铁律 + 一句 anti-pattern（指向 outcome-rules）
  - `orchestration/skills/flow-debugger/scripts/analyze-logs.py` — 工具 `done>0` 时 `[提示]` 勿误报鉴权（含 ReAct 重试语义）
- **模板变更**：无（不改 `deepagents-flow-ts` 运行时）
- **约束/规则对齐要点**：判据是「工具最终是否有产出」而非「过程是否出现 auth 报错」；ReAct 会重试消化瞬态 auth 波动；仅工具始终无产出 + 401/凭证硬错误才算鉴权；`--expect-tool` 禁止中文登记名
- **回朔**：`git checkout <commit> -- packages/dev-agent-flow/orchestration packages/dev-agent-flow/iteration`
- **后台**：否（待人工同步 system-prompt / flow-debugger）

---

## iter-0.2.1 — 2026-07-12

- **摘要**：防开发技能污染 — 明确开发 Agent 三件套不得进入目标业务 Agent 的 `systemPrompt` / `skills` / `tools`
- **交付变更**：
  - `orchestration/system-prompt.md` — `<PLATFORM_CONFIG>` / `<SESSION_CLOSE>` 增加防污染与回读检查
  - `orchestration/skills/flow-builder/SKILL.md` — L1 铁律增加开发技能污染禁区
  - `orchestration/skills/flow-builder/references/part3-tools-config.md` — 平台能力登记前置区分目标 Agent 与开发 Agent
  - `orchestration/skills/flow-builder/references/part5-prompt-design.md` — 提示词同步与 checklist 增加运行时段落 / 开发技能污染检查
- **模板变更**：无（不改 `deepagents-flow-ts` 运行时）
- **约束/规则对齐要点**：目标 Agent 只写业务契约与业务能力；`Available Skills` / `Available MCP Servers` 由目标运行时自动追加，不得复制；`flow-builder` / `dev-engineer-toolkit` / `flow-debugger` 只属于开发 Agent
- **验证**：`pnpm iteration:static` 通过
- **回朔**：`git checkout <commit> -- packages/dev-agent-flow/orchestration packages/dev-agent-flow/iteration`
- **后台**：否（待人工同步 system-prompt / flow-builder）

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
