# Part 4a：验证与调试（强制）

> 所属：`flow-builder` L2-D。入口路由见 [SKILL.md](../SKILL.md)。
> 系统提示词 `<COMPLETION_GATE>` / `<DEBUG_LOGS>` 的**详细执行依据**在本层。

## 完成闸门

报告「完成 / done」前必须在本轮真实执行并贴出原始输出：

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm graph && pnpm smoke
```

失败 → 读完整错误 → 修复 → 重跑；至多 5 轮仍不绿则如实交回用户。

**ACP 真实运行门**：目标 Agent 部署在 rcoder（云端）或 nuwaclaw（个人客户端）时，运行时均经 ACP。`pnpm smoke` 用 rcoder-cli 端到端复现（握手 → `onPrompt` → 整图 → 流式答案），是生产路径的质量门；静态四连不能替代，禁止 `--dry-run` 冒充通过。非默认入口用 `--entry` 或 `pnpm smoke -- --example <name>`。

Scaffold 生成器自带快检（`typecheck && graph`）；**全量闸门仍须上式五连**。

**smoke 细则**（`.env` 模型解析、`activeFlow`、`SMOKE_PROMPT*`、占位符）→ [part4b-smoke-acp.md](part4b-smoke-acp.md)。

---

## 验证命令

```bash
pnpm build
pnpm test                    # 含 tests/layering.test.ts
pnpm typecheck
pnpm typecheck:examples      # 改了 examples 时
pnpm smoke               # 强制：rcoder-cli ACP 端到端（非默认入口可用 --example 或 --entry）
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
- `permission 门控` / `requestPermission` — 工具审批放行/弹窗/降级（`flow-acp` 子 logger）

---

## 读日志六步（编排 / ACP / HITL）

图跑不通、节点未执行、条件边走错、HITL 不 resume、工具 `Permission denied` / 客户端卡转圈、ACP 无响应时：

1. **确认** — env 含 `LOG_DIR`、`LOG_LEVEL`（HITL 用 `debug`）
2. **复现** — Zed / `pnpm smoke` / `pnpm example` / CLI
3. **定位** — `.logs/` 最新 `.log` 或按 sessionId
4. **过滤** — 对照 graph 顺序、节点名、tool 名、HITL 轮次
5. **修复验证** — 改后重跑，新日志确认错误消失
6. **记录** — 根因摘要写入 `project.md`（不粘贴整段 log）

---

## 典型错误：`LLM 未返回 JSON`

**规则**：[flow-graph-rules-pointer.md](flow-graph-rules-pointer.md) → 目标项目 **R-G001 / R-G002**。完整六步亦见目标项目 `docs/troubleshooting.md`。

| 步 | 动作 |
|----|------|
| 1 | 日志搜 `LLM 未返回 JSON` 或节点 `label`（如 `prepare`） |
| 2 | 打开 `src/app/flows/<name>/graph.ts` 对应节点，查是否有 `parse: parseJson` |
| 3 | 查 `write` 是否使用 `r.parsed` — **未使用则删 `parse`** |
| 4 | 若必须结构化：加强 prompt JSON schema / 加 `fallback` 或换 `createLlmRouterNode` + `routeFallback` |
| 5 | 若入口节点：改 prompt 支持非预期输入（打招呼、格式错误），不强求 JSON |
| 6 | **同步** `scripts/scaffold/specs/<name>.flow.json`（手改 graph 后 regenerate 会覆盖修复） |

详表见目标项目 `docs/troubleshooting.md` § `LLM 未返回 JSON`。

---

## 典型错误：无流式 / 回答一次性整段出现

**规则**：[flow-graph-rules-pointer.md](flow-graph-rules-pointer.md) → 目标项目 **R-G009**；Part 2 § 流式输出。

| 步 | 动作 |
|----|------|
| 1 | 确认症状：ACP/客户端长时间无字，最后一次性出全文（`streamed=false` 兜底） |
| 2 | 打开 `src/app/flows/<name>/graph.ts`，查用户可见节点（compose / aggregate / draft / finalize 修订） |
| 3 | 若用 `createLlmNode` → 改为 **`createLlmStreamNode`**，`write` 从 `r.content` 改为 **`r.text`**，补 `timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs` |
| 4 | 若来自 scaffold：查 `scripts/scaffold/specs/<name>.flow.json` 是否 `type: "llm-stream"` 且 `write` 用 `r.text` |
| 5 | **同步** spec 与 graph（**R-G003**）；重跑 `pnpm smoke` 观察逐 token |
| 6 | 仍不流式：确认模型支持 `.stream()`；查目标项目 README § 流式输出检查清单 L2/L3 降级 |

**与工具 EXECUTING 的关系**：图在 LLM 节点抛错未走完时，并行调试命令可能长时间显示 EXECUTING；先修图错误再判工具层。

---

## 典型错误：联网搜索不生效 / 误用内置 search

**规则**：Part 3 § 联网搜索；system-prompt `<WEB_SEARCH>`。

| 步 | 动作 |
|----|------|
| 1 | 确认需求是**互联网/实时**检索，而非工作区内 grep（内置 `search` 仅后者） |
| 2 | 是否已 `search-apis.sh --kw "搜索"` / `get-config.sh --key mcpConfigs`？未搜平台 → 先补 |
| 3 | Plugin 命中是否已 `add-tool.sh` 并在 `flow-tools.ts` 注册？MCP 是否对齐 `mcp.default.json`？ |
| 4 | `travel-planner` / custom `mcp-retrieval`：`searchMcp` 是否传入平台登记的搜索 MCP？未传则 research 优雅降级（无结果） |
| 5 | 禁止用 `bash`+`curl` / 自写 DDG 替代平台能力；`pnpm exec tsx src/index.ts capabilities` 核对 MCP/工具列表 |
| 6 | 仍无结果：查 MCP 工具名是否与 `chooseMcpToolName` 匹配；`onToolCall` / 日志是否有检索调用 |

---

## Anti-patterns

- ❌ 未跑通就声称完成
- ❌ 不看 `.logs/` 就猜 ACP/HITL 行为
- ❌ 把 `.log` 全文贴进对话或提交 git
- ❌ 见 JSON 解析错就加更严 prompt，不检查 `write` 是否真需要 `r.parsed`
- ❌ 用户反馈「不流式」却只改 ACP/客户端，不检查节点是否误用 `createLlmNode`
- ❌ 用户要「联网搜索」却只用内置 `grep`/`search`，或未搜平台就自写搜索 API
- ✅ 命令退出码 0 + 文件实证 + 日志无未预期 error
