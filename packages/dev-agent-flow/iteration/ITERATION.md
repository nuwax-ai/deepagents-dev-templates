# 智能体开发 Agent · 迭代台账

本文件属 **迭代层**（[`iteration/`](.)），**不下发**编排后台。  
**交付层**真源：[`../orchestration/`](../orchestration/)（`system-prompt.md` / `user-prompt.md` / `skills/*`，人工同步后台）。

## 模板（新开一轮复制）

```markdown
### YYYY-MM-DD · <短标题>

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

#### 验证
- [ ] `pnpm iteration:static`
- [ ] `pnpm iteration:drift -- --platform <导出.json>`（同步后台后）
- [ ] 人工已把 orchestration/ 同步到编排后台

#### 结论
-
```

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
