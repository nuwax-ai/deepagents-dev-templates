# Part 4a：验证与调试（强制）

> 所属：`flow-builder` L2-D。入口路由见 [SKILL.md](../SKILL.md)。
> completion gate（完成闸门）与读日志排错的**详细执行依据**在本层；总清单见 [part0-workflow.md](part0-workflow.md) § completion gate 收尾清单。

## completion gate（完成闸门）

本地开发迭代优先用 flow-debugger `debug.sh --message "<短 prompt>"`，快速确认主路径能在平台真实链路跑通；收工真实运行验证也必须走 flow-debugger。本地 `pnpm smoke` / rcoder-cli 已移除。

报告「完成 / done」前必须在本轮真实执行并贴出原始输出：

```bash
pnpm typecheck && pnpm test && pnpm graph
flow-debugger/scripts/debug.sh --message "..." [--expect-tool <工具名子串>]
```

失败 → 读完整错误 → 修复 → 重跑；至多 5 轮仍不绿则如实交回用户。

**真实运行门**：flow-debugger 用平台真实会话端到端复现完整运行路径，是生产路径的质量门；静态三连不能替代。执行应出现在用户 agent-dev 预览会话。

Scaffold 生成器自带快检（`typecheck && graph`）；开发中可追加 flow-debugger 短 prompt，**全量 completion gate 仍须三连 + flow-debugger 真实调试**。

**收尾清单**（系统提示词非空、R-G009、**平台能力搜索证据**等）→ [part0-workflow.md](part0-workflow.md) § completion gate 收尾清单。

**flow-debugger 细则**（真实执行、工具断言、HITL、会话管理、日志分析）→ [part4b-smoke.md](part4b-smoke.md)。

---

## 验证命令

```bash
pnpm test                    # 含 tests/layering.test.ts
pnpm typecheck
pnpm graph
# flow-debugger/scripts/debug.sh --message "..." --expect-tool <工具名子串>
```

---

## 日志约定（`.logs/`）

| 项 | 约定 |
|----|------|
| 目录 | `<REPO>/.logs/`（`LOG_DIR=<REPO>/.logs`） |
| 配置 | `LOG_LEVEL=debug` + `LOG_DIR=<REPO>/.logs`（见 `.env.example`） |
| 文件名 | `<agentName>-<sessionId>-<YYYY_MM_DD>.log` |
| 实现 | `src/runtime/logger.ts` |

未设 `LOG_DIR` 可能回退 `~/.flowagents/logs/`；**开发排查优先项目根 `.logs/`**（勿提交）。

### 常见前缀（过滤）

- `runtime:flow-graph` — 图调度、边路由
- `runtime:<flow名>` — flow 生命周期
- `error` / `warn` / `interrupt` / `onPrompt`
- `permission 门控` / `requestPermission` — 工具审批放行/弹窗/降级

---

## 读日志六步（编排 / 客户端 / HITL）

图跑不通、节点未执行、条件边走错、HITL 不 resume、工具 `Permission denied` / 客户端卡转圈、客户端无响应时：

1. **确认** — env 含 `LOG_DIR`、`LOG_LEVEL`（HITL 用 `debug`）
2. **复现** — flow-debugger `debug.sh` / `pnpm flow` / CLI（迭代期勿 `pnpm build`）
3. **定位** — `.logs/` 最新 `.log` 或按 sessionId
4. **过滤** — 对照 graph 顺序、节点名、tool 名、HITL 轮次
5. **修复验证** — 改后重跑，新日志确认错误消失
6. **记录** — 根因摘要写入 `project.md`（不粘贴整段 log）

---

## 典型错误：`LLM 未返回 JSON`

**规则**：[flow-graph-rules-pointer.md](flow-graph-rules-pointer.md) → 当前工作目录 **R-G001 / R-G002**。完整六步亦见当前工作目录 `docs/troubleshooting.md`。

| 步 | 动作 |
|----|------|
| 1 | 日志搜 `LLM 未返回 JSON` 或节点 `label`（如 `prepare`） |
| 2 | 打开 `src/app/flows/<name>/graph.ts` 对应节点，查是否有 `parse: parseJson` |
| 3 | 查 `write` 是否使用 `r.parsed` — **未使用则删 `parse`** |
| 4 | 若必须结构化：加强 prompt JSON schema / 加 `fallback` 或换 `createLlmRouterNode` + `routeFallback` |
| 5 | 若入口节点：改 prompt 支持非预期输入（打招呼、格式错误），不强求 JSON |
| 6 | **同步** `scripts/scaffold/specs/<name>.flow.json`（手改 graph 后 regenerate 会覆盖修复） |

详表见当前工作目录 `docs/troubleshooting.md` § `LLM 未返回 JSON`。

---

## 典型错误：无流式 / 回答一次性整段出现

**规则**：[flow-graph-rules-pointer.md](flow-graph-rules-pointer.md) → 当前工作目录 **R-G009**；Part 2 § 流式输出。

| 步 | 动作 |
|----|------|
| 1 | 确认症状：客户端长时间无字，最后一次性出全文（`streamed=false` 兜底） |
| 2 | 打开 `src/app/flows/<name>/graph.ts`，查用户可见节点（compose / aggregate / draft / finalize 修订） |
| 3 | 若用 `createLlmNode` → 改为 **`createLlmStreamNode`**，`write` 从 `r.content` 改为 **`r.text`**，补 `timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs` |
| 4 | 若来自 scaffold：查 `scripts/scaffold/specs/<name>.flow.json` 是否 `type: "llm-stream"` 且 `write` 用 `r.text` |
| 5 | **同步** spec 与 graph（**R-G003**）；用 flow-debugger 重跑并观察流式输出 |
| 6 | 仍不流式：确认模型支持 `.stream()`；查当前工作目录 README § 流式输出检查清单 L2/L3 降级 |

**与工具 EXECUTING 的关系**：图在 LLM 节点抛错未走完时，并行调试命令可能长时间显示 EXECUTING；先修图错误再判工具层。

---

## 典型错误：平台能力未登记 / 误用内置工具 / 未搜平台就报完成

**规则**：Part 3 § 平台能力登记 · § **平台能力登记**（**联网搜索较常见**，见 § 联网搜索）；收工举证见 Part 0 § completion gate 收尾清单。

### completion gate 判定（需平台能力时 · 通用）

| 条件 | 结果 |
|------|------|
| 已贴 `search-apis` / `search-skills` / `get-config` 输出，平台无命中 | 可完成；可自写 app 工具或图内降级（须记录关键词） |
| 平台有命中，已 `add-tool`，并按需对齐节点或接入 `flow-tools.ts` | 可完成 |
| **未执行**平台搜索就写外部能力 | **不可报完成**（即使真实调试绿） |
| 平台有命中但未 `add-tool` / 未接线 | **不可报完成** |
| 以「用户待配置」代替开发期登记 | **不可报完成** |

### 联网搜索（常见专项 · 追加检查）

| 条件 | 结果 |
|------|------|
| 已贴搜索关键词 + `tools` 输出，平台无搜索能力 | 可完成；图内可写降级文案 |
| 平台有搜索工具/API 且已接线 | 可完成 |
| 未执行 `search-apis --kw 搜索` 或未查 `tools` | **不可报完成** |
| 平台有命中但仍留搜索占位配置 | **不可报完成** |

| 步 | 动作 |
|----|------|
| 1 | 确认需**工作区外**能力（非仅 `grep`/`glob`） |
| 2 | 是否已 `search-apis.sh --kw "<能力词>"` / `search-skills.sh` / `get-config.sh --key tools|skills`？ |
| 3 | 命中是否已 `add-tool.sh`，并按需在节点 `params` 指定 `toolName` / `tools` 或接入 `flow-tools.ts`？ |
| 4 | **联网**：另查 `tools` 与平台搜索工具登记状态；禁止 bash+curl 自写搜索 API；禁止把搜索能力硬编码进当前项目默认配置 |
| 5 | `pnpm capabilities` 核对工具列表 |
| 6 | 仍不生效：查工具名、`.logs/` 中 `onToolCall` |

---

## 典型错误：Subagent（子智能体）

| 日志/症状 | 处理 |
|-----------|------|
| `未知工具: 联网搜索_1` | 删 `AGENT.md` 的 `tools`（禁止写平台登记名）→ Part 6 |
| `400 Invalid model` + 占位符 | 删 `AGENT.md` 的 `model`，继承主 Agent |
| `(subagent 无输出)` | 确认 `description` 自包含；框架已有 stream buffer 兜底 → Part 6 |
| 联网搜索 `401` | 检查平台搜索能力 的会话 Authorization 是否正确下发并由父/子 agent 复用 |
| 并行 `task` 输出混流 | runtime `messageId` 含 `toolCallId`（runtime 层）；仍混流查平台是否尊重 messageId |
| `INVALID_TOOL_RESULTS` | 删 `~/.flowagents/sessions/<hash>/pending.json` 清 checkpoint |

详表 → [part6-subagent.md](part6-subagent.md)。

---

## Anti-patterns

- ❌ 未跑通就声称完成
- ❌ 不看 `.logs/` 就猜客户端/HITL 行为
- ❌ 把 `.log` 全文贴进对话或提交 git
- ❌ 见 JSON 解析错就加更严 prompt，不检查 `write` 是否真需要 `r.parsed`
- ❌ 用户反馈「不流式」却只改客户端，不检查节点是否误用 `createLlmNode`
- ❌ 需外部能力却未 `search-apis` / `get-config` / `add-tool` 就以真实调试通过报完成
- ❌ 用户要业务 API/联网却只用内置 `grep`/`search`，或未搜平台就自写工具
- ❌ 平台有能力却留占位未接线，把登记甩给「用户待操作」
- ❌ Phase 4 复述沙箱环境变量名，或要求用户配置平台已默认集成的认证/基址
- ❌ Phase 4 写「后续：配置 Plugin Authorization / 搜索 API key」等开发期登记事项
- ❌ `AGENT.md tools` 写平台 Plugin 登记名（如 `联网搜索_1`）→ `task` 报未知工具
- ❌ 同轮并行多个 `task` 且平台未分桶 messageId → 查 runtime，不靠提示词强制串行
- ✅ 命令退出码 0 + 文件实证 + 日志无未预期 error
- ✅ 无用户业务待办 → Phase 4 **不写**「后续」段
