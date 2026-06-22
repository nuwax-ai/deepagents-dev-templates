# Part 4：验证与调试（强制）

> 所属：`flow-builder` L2-D。入口路由见 [SKILL.md](../SKILL.md)。
> 系统提示词 `<COMPLETION_GATE>` / `<DEBUG_LOGS>` 的**详细执行依据**在本层。

## 完成闸门

报告「完成 / done」前必须在本轮真实执行并贴出原始输出：

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm graph
```

失败 → 读完整错误 → 修复 → 重跑；至多 5 轮仍不绿则如实交回用户。

Scaffold 生成器自带快检（`typecheck && graph`）；**全量闸门仍须上式四连**。

---

## 验证命令

```bash
pnpm build
pnpm test                    # 含 tests/layering.test.ts
pnpm typecheck
pnpm typecheck:examples      # 改了 examples 时
pnpm smoke:acp               # 或 pnpm smoke:<example>
pnpm graph                   # 导出拓扑
```

---

## 日志约定（`.logs/`）

| 项 | 约定 |
|----|------|
| 目录 | `<REPO>/.logs/`（`LOG_DIR=<REPO>/.logs`） |
| 配置 | `docs/zed-debug.md`：`LOG_LEVEL=debug` + `LOG_DIR` |
| 文件名 | `<agentName>-<sessionId>-<YYYY_MM_DD>.log` |
| 实现 | `src/runtime/logger.ts` |

未设 `LOG_DIR` 可能回退 `~/.flowagents/logs/`；**开发排查优先项目根 `.logs/`**（勿提交）。

### 常见前缀（过滤）

- `runtime:flow-graph` — 图调度、边路由
- `runtime:<flow名>` — flow 生命周期
- `error` / `warn` / `interrupt` / `onPrompt`

---

## 读日志六步（编排 / ACP / HITL）

图跑不通、节点未执行、条件边走错、HITL 不 resume、ACP 无响应时：

1. **确认** — env 含 `LOG_DIR`、`LOG_LEVEL`（HITL 用 `debug`）
2. **复现** — Zed / `pnpm smoke:*` / CLI
3. **定位** — `.logs/` 最新 `.log` 或按 sessionId
4. **过滤** — 对照 graph 顺序、节点名、tool 名、HITL 轮次
5. **修复验证** — 改后重跑，新日志确认错误消失
6. **记录** — 根因摘要写入 `project.md`（不粘贴整段 log）

---

## Anti-patterns

- ❌ 未跑通就声称完成
- ❌ 不看 `.logs/` 就猜 ACP/HITL 行为
- ❌ 把 `.log` 全文贴进对话或提交 git
- ✅ 命令退出码 0 + 文件实证 + 日志无未预期 error
