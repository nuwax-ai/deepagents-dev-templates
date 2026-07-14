---
name: flow-debugger
description: "当需要对目标 Agent 做平台侧真实调试运行时使用：端到端验证 flow 是否跑通、断言平台能力是否真实调用、管理调试会话、处理权限审批与 ask-question、用 runtime 日志佐证收工。非本地 pnpm flow；收工须 SSE + 日志双证。细节见正文与 references/operations.md。Keywords: 调试, 真实执行, 端到端验证, expect-tool, HITL, ask-question, 双证, flow-debugger"
tags: [debug, verify, e2e, sse, outcome, tool-assertion, multi-turn, hitl, session, smoke-replacement]
version: "1.6.0"
---

# 真实调试（flow-debugger）

## 分层结构

```
flow-debugger/
├── SKILL.md                 ← L1 入口（本文件）：何时用 / 收工门禁 / HITL 摘要
└── references/
    ├── operations.md        ← 参数表 / 会话策略 / 脚本用法 / 退出码 / Windows
    ├── sse-events.md        ← SSE 事件 + 平台端点契约
    └── outcome-rules.md     ← 通过/失败判定 + 勿误报鉴权
```

**渐进加载**：`load_skill` 先读本文件；跑命令前再 `Read` [operations.md](references/operations.md)。判据 / 契约按需打开 outcome-rules、sse-events。

## 概述

做平台侧真实调试运行，提供真实链路的调试能力（非本地 `pnpm flow`）。执行挂到平台调试预览会话，用户可在预览面板看到输出。

| 脚本 | 能力 | 对应平台调试操作 |
|------|------|------------------|
| `scripts/debug.sh` | 发 prompt 驱动真实执行（SSE）+ 判定 + 工具断言 + HITL + 超时 | 预览面板发消息 |
| `scripts/session.sh` | `new` / `refresh` / `wait` / `current` / `cancel` | 刷子代建 / 手动点 / 停止 |
| `scripts/approve.sh` | 权限审批响应（批准/拒绝） | 权限弹窗 |
| `scripts/analyze-logs.sh` | 分析 `.logs/` runtime 日志佐证 | — |

## When to Use

1. **收工验证 flow 端到端跑通** — `debug.sh --with-logs`
2. **验证平台能力真实调用** — `--expect-tool <runtime/SSE 英文工具名子串>`
3. **管理调试会话** — `session.sh new`（推荐）或刷子后 `refresh`/`wait`
4. **处理权限审批** — `--auto-approve` 或 exit 5 后 `approve.sh`
5. **回答 ask-question** — exit 5 后 `--message` + `--ask-marker`
6. **runtime 日志佐证** — 收工必经；报完成须贴 `[结论]` / `[flow 状态]` / `[工具调用]`

## 收工双证：平台 SSE + runtime 日志

不能只看 `[OUTCOME] PASS` 或 `debug.sh` exit 0：

| 视角 | 脚本 | 佐证什么 |
|------|------|----------|
| 平台 SSE | `debug.sh` | 可见输出、工具 trace、`--expect-tool` |
| runtime | `analyze-logs.sh` | `.logs/` 错误、flowStatus、失败工具、permission/模型 |

**默认收工命令**（一步双证；改过 flow 代码优先开新会话）：

```bash
./scripts/debug.sh --new-session --message "…" --expect-tool <子串> --with-logs --auto-approve
```

二者均 exit 0 且 stderr 有 `日志佐证通过` / `[结论] 日志正常` 方可报完成。SSE 绿但日志红 → **仍失败**。  
断言未命中、日志找不到、勿误报鉴权等细则 → [operations.md](references/operations.md) + [outcome-rules.md](references/outcome-rules.md)。

## 会话策略（摘要）

- 收工/回归 → `--new-session` 或 `session.sh new`
- 同会话续轮 → 先终态，或 `--wait-idle`
- cancel 后复用 → 高风险；优先新会话
- 强制 busy 写入 → 仅冲突复现时 `--allow-busy`

完整说明 → [operations.md](references/operations.md) § 会话安全策略。

## HITL 摘要

| 类型 | 处理 |
|------|------|
| 权限审批 | `--auto-approve`，或 exit 5 → `approve.sh` |
| ask-question | exit 5 → `debug.sh --message "<答案>" --ask-marker <requestId>`（同 `conversationId` 续接） |

细节与退出码表 → [operations.md](references/operations.md)。

## 关联技能

| 技能 | 何时用 |
|------|--------|
| **flow-builder Part 4a** | 本地 `.logs/` 六步排查（与 `analyze-logs` 互补） |
| **flow-builder Part 4b** | 收工必经路由到本技能（本 Skill 即证据源） |
| **dev-engineer-toolkit** | 调试前确认工具已登记：`get-config.sh --key tools` |

## Anti-patterns

- ❌ 只看 `debug.sh` exit 0、不跑 `--with-logs` / 不贴日志摘要
- ❌ 用 `pnpm flow` 冒充真实调试
- ❌ 登记了工具却不 `--expect-tool`
- ❌ HITL 不处理导致会话卡住
- ❌ 命令行内联多行中文（用 `--message-file`）
- ❌ 手写 curl 调 4sandbox（统一 `./scripts/*.sh`）
- ❌ `EXECUTING` 时普通连发；stop 后立刻复用旧会话
- ❌ 工具已有产出却写 Authorization 待办（勿误报鉴权）
- ✅ 收工：`debug.sh --new-session … --with-logs` + 需要时 `--expect-tool`

## 参考

- [operations.md](references/operations.md) — 参数表 / 会话 / 脚本 / 退出码 / Windows
- [sse-events.md](references/sse-events.md) — SSE + 端点契约
- [outcome-rules.md](references/outcome-rules.md) — 判定规则 + 勿误报鉴权
