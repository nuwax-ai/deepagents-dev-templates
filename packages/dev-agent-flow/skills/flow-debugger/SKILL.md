---
name: flow-debugger
description: "当需要用平台真实链路端到端调试目标 Agent、验证 flow 真实跑通、断言平台能力真实调用、管理调试会话（新建/取消）、处理权限审批与 ask-question、或分析 runtime 日志时使用。严格镜像 nuwax agent-dev 调试会话：发 prompt 驱动平台真实 agent 执行（非本地模拟），收 SSE 结构化结果（文本 + 工具调用 trace + 错误），自动判定通过/失败；执行出现在用户 agent-dev 预览会话。Keywords: 调试, debug, 真实执行, 端到端验证, 工具调用断言, 会话管理, 权限审批, ask-question, HITL, 多轮对话, SSE, outcome, 错误定位, 日志分析, 预览会话, flow-debugger"
tags: [debug, verify, e2e, sse, outcome, tool-assertion, multi-turn, hitl, session, smoke-replacement]
version: "1.0.0"
---

# 真实调试（flow-debugger）

## 概述

严格镜像 nuwax agent-dev 调试会话，提供平台真实链路的调试能力（非本地 rcoder-cli 模拟）。

| 脚本 | 能力 | 对应 agent-dev 操作 |
|------|------|---------------------|
| `scripts/debug.sh` | 发 prompt 驱动真实 agent 执行（SSE）+ 通过/失败判定 + 工具断言 + HITL 处理 + 超时保护 | 预览面板发消息 |
| `scripts/session.sh` | 新建会话（`new`，刷子）/ 获取当前会话（`current`）/ 取消（`cancel`，停止） | 刷子 / 停止按钮 |
| `scripts/approve.sh` | 权限审批响应（批准/拒绝） | 权限弹窗批准/拒绝 |
| `scripts/analyze-logs.sh` | 分析 `.logs/` runtime 日志（错误/工具调用/flow 状态/permission/模型问题） | — |

> ask-question（`nuwax_ask_question` 工具）**无专用响应端点**——答案作为普通 chat 消息回流，用 `debug.sh --message "<答案>" --ask-marker <requestId>` 续接（见下）。

所有脚本由平台沙箱运行时自动配置（`PLATFORM_BASE_URL` / `SANDBOX_ACCESS_KEY` / `DEV_AGENT_ID` / `CONVERSATION_ID`），直接执行即可。

## 关键特性：用户预览会话可见

`debug.sh` 默认读沙箱注入的 `CONVERSATION_ID`（= 用户 nuwax agent-dev 预览会话 = 业务 Agent 的 `devAgentConversationId`），作为 `conversationId` 传给后端。后端把执行挂到该会话 → **用户在 agent-dev 预览面板能实时看到调试输出**（文本/工具调用/结果）。这是与本地模拟的核心区别。

## When to Use

1. **收工验证 flow 端到端跑通** — `debug.sh`（替代已移除的本地 `pnpm smoke`）。
2. **验证平台能力真实调用** — `debug.sh --expect-tool <工具名子串>`，断言工具被调用且成功。
3. **管理调试会话** — `session.sh new/current/cancel`（新建/获取/停止）。
4. **处理权限审批** — `debug.sh --auto-approve` 自动批准；或遇 exit 5 用 `approve.sh` 响应。
5. **回答 ask-question** — 遇 exit 5 用 `debug.sh --message "<答案>" --ask-marker <requestId>` 续接。
6. **runtime 日志诊断** — `analyze-logs.sh`（与 debug.sh 的平台结果互补）。

## 后端依赖

依赖后端把 nuwax 的 agent 会话接口转到 4sandbox 下（端点前缀 `/api/v1/4sandbox/agent/dev`，子路径与 nuwax 一致）。契约集中在 `scripts/debug_http.py` 顶部常量，后端 ready 后若路径/字段有差异只改那里。端点未就绪时退出码 3 + 提示。完整契约与给后端的约束见 `references/sse-events.md`。

## 完整操作

### 1. 发消息真实执行 — `debug.sh`

```bash
./scripts/debug.sh --message "你是谁？"                    # 执行出现在用户预览会话
./scripts/debug.sh --message-file prompts/test.md          # 中文/长 prompt 用 UTF-8 文件
./scripts/debug.sh --message "搜索今天的AI新闻" --expect-tool search   # 工具调用断言
./scripts/debug.sh --message "测试" --auto-approve         # 自动批准权限审批
./scripts/debug.sh --message "第二轮" --conversation <id>  # 多轮续接
./scripts/debug.sh --message "答案" --ask-marker <requestId>          # 回答 ask-question
./scripts/debug.sh --message "测试" --show-trace --max-time 900       # 完整 trace + 总时长上限
```

| 参数 | 说明 |
|------|------|
| `--message` / `--message-file` | 调试 prompt（文本 / UTF-8 文件，二选一） |
| `--conversation` | 会话 ID（默认 `CONVERSATION_ID` env） |
| `--expect-tool` | 期望被调用的工具名子串（断言 `componentExecuteResults` 命中且 success） |
| `--auto-approve` | 自动批准权限审批（选首个 allow option） |
| `--ask-marker` | 回答 ask-question：把 `<!--nuwax-mcp-ask-request-id:<requestId>-->` 追加到 message 末尾 |
| `--variables` | 变量参数（JSON 字符串） |
| `--timeout` / `--max-time` | SSE 单次读取超时（默认 180s）/ 总时长上限（默认 600s，0=不限） |
| `--show-trace` / `--quiet` | 输出完整工具 trace / 不回显流式文本 |

**输出**：stdout = agent 文本（流式）；stderr = `[DEBUG]`/`[OUTCOME] PASS|FAIL`/`[进度]`/失败时 `[原因]`。

### 2. 会话管理 — `session.sh`

```bash
./scripts/session.sh new                                    # 新建会话（刷子）→ 新 conversationId
./scripts/session.sh current                                # 当前会话内容/历史
./scripts/session.sh cancel                                 # 取消/停止（默认 CONVERSATION_ID）
./scripts/session.sh cancel --conversation <id>             # 取消指定会话
```

### 3. 权限审批响应 — `approve.sh`

`debug.sh` 遇 `ACP_REQUEST_PERMISSION` 未 `--auto-approve` 而 exit 5 时，用本脚本响应（option-id 来自 exit 5 列出的 options）：

```bash
./scripts/approve.sh --tool-id <toolCallId> --option-id <allow_option_id> --outcome selected    # 批准
./scripts/approve.sh --tool-id <toolCallId> --option-id <reject_option_id> --outcome cancelled  # 拒绝
```

### 4. runtime 日志分析 — `analyze-logs.sh`

```bash
./scripts/analyze-logs.sh                # 分析最新 .logs/ 日志
./scripts/analyze-logs.sh --session <id> # 按会话过滤
./scripts/analyze-logs.sh --since 10     # 最近 10 分钟
./scripts/analyze-logs.sh --file <path>  # 指定文件
```

> 日志目录优先级：`--dir` > `LOG_DIR` env > `<cwd>/.logs` > `~/.flowagents/logs`。

## HITL 处理流程

`debug.sh` 执行时，SSE 流可能来两类人工介入事件：

| 事件 | 触发 | `debug.sh` 行为 |
|------|------|----------------|
| **权限审批** `ACP_REQUEST_PERMISSION`（或 `PROCESSING`+`subEventType=REQUEST_PERMISSION`） | agent 要执行需审批的工具 | `--auto-approve` → 自动批准首个 allow option（调 `permission-request/response`），继续流；否则 exit 5 + 列出 options（用 `approve.sh` 响应） |
| **ask-question** `PROCESSING`+`subEventType=ASK_QUESTION`（`nuwax_ask_question`） | agent 向用户提问 | exit 5 + 输出 question（requestId/title）；用 `debug.sh --message "<答案>" --ask-marker <requestId>` 续接（答案作为普通消息回流，带 marker） |

> 响应 HITL 后用**同一 `conversationId`** 续接，上下文保持。

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功（debug.sh 通过 / session/approve/analyze 成功且未发现问题） |
| 1 | 参数错误 |
| 2 | 平台运行时未就绪（沙箱 env 缺失） |
| 3 | HTTP/SSE 失败（含后端端点未就绪 / 超时 / 流异常中断）；analyze-logs 找不到日志 |
| 4 | 调试不通过（outcome 判定失败）；analyze-logs 发现问题 |
| 5 | 遇 HITL（权限审批/ask-question）待人工响应（仅 debug.sh） |

## Windows / 编码

本地 Windows 命令走 Git Bash；`python3` 常为商店占位（不可用），统一执行 `./scripts/*.sh`（内部 `lib/ensure-python.sh` 自动探测 `python → python3 → py -3 → uv`），**禁止** `python3` 失败后改手写 `curl`。中文/长 prompt 用 `--message-file` 指向 UTF-8 文件，**禁止**命令行内联多行中文。

```bash
./scripts/check-python.sh --install   # Python 不可用时（需 PATH 中有 uv）
```

> 脚本内部 `.py` 走 `configure_stdio_utf8()` + 请求头 `charset=utf-8` + `ensure_ascii=False`，中文不会乱码（与 `dev-engineer-toolkit` 同机制）。

## 关联技能

| 技能 | 何时用 |
|------|--------|
| **flow-builder Part 4a** | 本地 `.logs/` runtime 日志六步排查（与 analyze-logs.sh 互补） |
| **dev-engineer-toolkit** | 调试前确认配置/工具已登记：`get-config.sh --key tools` |

## Anti-patterns

- ❌ **用本地模拟冒充真实调试**：rcoder-cli 本地 smoke 已移除；收工验证用 `debug.sh`（平台真实链路 + 用户预览可见）。
- ❌ **工具登记了却不验证真实调用**：`--expect-tool` 断言 `componentExecuteResults` 命中且 success。
- ❌ **HITL 不处理**：权限审批用 `--auto-approve` 或 `approve.sh`；ask-question 用 `--ask-marker` 续接，别让会话卡住。
- ❌ **绕过脚本手写 curl 调 4sandbox**：统一走 `./scripts/*.sh`。
- ❌ **命令行内联多行中文 prompt**：用 `--message-file` 读 UTF-8 文件。
- ✅ **收工用 debug.sh**：走平台真实链路 + 用户预览可见。
- ✅ **平台能力用 --expect-tool 断言** + **HITL 用 --auto-approve/approve.sh/--ask-marker 处理**。

## 参考

- `references/sse-events.md` — SSE 事件结构 + AgentExecuteResult + 严格 nuwax 端点契约 + 给后端约束
- `references/outcome-rules.md` — 通过/失败判定规则 + 工具断言 + 错误聚合
