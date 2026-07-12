# 智能体开发 Agent · 迭代台账

本文件属 **迭代层**（[`iteration/`](.)），**不下发**编排后台。  
**交付层**真源：[`../orchestration/`](../orchestration/)（`system-prompt.md` / `user-prompt.md` / `skills/*`，人工同步后台）。

## 模板（新开一轮复制）

过不了「方向三问」不要升 `iter-*`、不要改交付。目标须能写成：  
**开发者做 X 时，开发 Agent 应 Y，用 Z 验证。**

```markdown
### YYYY-MM-DD · <短标题>

#### 版本号
- iter-X.Y.Z（同步追加 [`VERSIONS.md`](VERSIONS.md) 条目）

#### 方向三问（全过再动手）
- [ ] 打中的是开发者痛点（收工 / 改图 / 平台能力 / 沟通…），不是「再润色一段」？
- [ ] 改完后人工同步编排后台，开发 Agent 能立刻用上？
- [ ] 回朔路径写得清（VERSIONS 文件清单 / git）？

#### 本轮目标句
- 开发者做 __ 时，开发 Agent 应 __，用 __ 验证。

#### 需求确认
- 已确认：
- 待确认：

#### 本轮优化目标
-

#### 方案（改哪些交付文件）
- [ ] orchestration/system-prompt.md
- [ ] orchestration/user-prompt.md
- [ ] orchestration/skills/...
- [ ] orchestration/agent.manifest.json（期望清单，非后台文件）
- [ ] packages/deepagents-flow-ts/...（仅对齐需要时）

#### 验证
- [ ] `pnpm iteration:static`（契约自洽）
- [ ] `pnpm iteration:drift -- --platform <导出.json>`（同步后台后）
- [ ] 人工已把 orchestration/ 同步到编排后台
- [ ] 真实会话抽测打中「本轮目标句」的 Y（static 绿 ≠ 方向对）

#### 结论
-
```

---

## 2026-07-12 · 防开发技能污染 iter-0.2.1

#### 版本号
- iter-0.2.1（已写 [`VERSIONS.md`](VERSIONS.md)）

#### 需求确认
- 已确认：不改 `deepagents-flow-ts` 运行时；通过提示词 / skill / 文档约束防止目标 Agent 泄漏开发 Agent 的能力清单与提示词
- 待确认：无

#### 本轮优化目标
- 防止交付目标业务 Agent 时，把 `flow-builder` / `dev-engineer-toolkit` / `flow-debugger` 或 `Available Skills` / `Available MCP Servers` 等运行时自动段落污染进目标 Agent

#### 方案（改哪些交付文件）
- [x] orchestration/system-prompt.md
- [x] orchestration/skills/flow-builder/SKILL.md
- [x] orchestration/skills/flow-builder/references/part3-tools-config.md
- [x] orchestration/skills/flow-builder/references/part5-prompt-design.md
- [ ] packages/deepagents-flow-ts/...（本轮不改运行时）

#### 验证
- [x] `pnpm iteration:static`
- [ ] 平台导出 drift
- [ ] 人工同步编排后台

#### 结论
- 仓内约束已对齐并通过静态门禁；后台待人工同步

---

## 2026-07-12 · 规则对齐 iter-0.2.0

#### 版本号
- iter-0.2.0（已写 [`VERSIONS.md`](VERSIONS.md)）

#### 需求确认
- 已确认：可按需改 `deepagents-flow-ts`；本轮对齐 ask-question / download-skill / MCP_USAGE
- 待确认：无

#### 本轮优化目标
- 拆清 ask-question 双口径；统一 download-skill 禁区；manifest 显式要求 MCP_USAGE；文档写明模板可改

#### 方案（改哪些交付文件）
- [x] orchestration/system-prompt.md
- [x] orchestration/agent.manifest.json
- [x] orchestration/skills/dev-engineer-toolkit/SKILL.md
- [ ] packages/deepagents-flow-ts/...（本轮核对后无需改）

#### 验证
- [x] `pnpm iteration:static`
- [ ] 平台导出 drift
- [ ] 人工同步编排后台

#### 结论
- 对齐完成；模板本轮无改动

---

## 2026-07-12 · 目录改为 orchestration + iteration

#### 需求确认
- 已确认：方案 B — `orchestration/`（交付）+ `iteration/`（台账与门禁）
- 待确认：无

#### 本轮优化目标
- 目录结构与双层职责对齐，去掉平铺歧义

#### 方案（改哪些交付文件）
- [x] 迁入 `orchestration/`（原包根 prompts / skills / manifest）
- [x] `harness/` → `iteration/`，脚本路径指向 `orchestration/`
- 迭代层：本台账与 README

#### 验证
- [x] `pnpm iteration:static`
- [ ] 平台导出 drift（待人工同步后台后）
- [ ] 人工已把 orchestration/ 同步到编排后台

#### 结论
- 结构已按 B 落地

---

## 2026-07-12 · Harness 双层落地 + MCP 用法收口

#### 需求确认
- 已确认：
  - 调优对象是 **智能体开发 Agent** 编排配置，人工配进后台
  - 迭代层只做台账 + 静态门禁 / drift，**不自动下发**
  - MCP 只调「如何用」；L0 `<MCP_USAGE>` 只写开发 Agent 自用指引
- 待确认：无

#### 本轮优化目标
- 建立交付层 vs 迭代层边界；落地静态检查；收口 MCP 用法文案

#### 方案
- [x] system-prompt `<MCP_USAGE>`
- [x] agent.manifest.json
- [x] 迭代层 checks / cases（当时目录名 harness，后改名 iteration）

#### 验证
- [x] static（sample fixture）

#### 结论
- 双层与门禁就绪；后台同步仍靠人工
