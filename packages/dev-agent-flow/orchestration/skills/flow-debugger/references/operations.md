# 操作细节（参数 / 会话 / 脚本 / 编码）

> L1 入口见 [../SKILL.md](../SKILL.md)。端点契约与 SSE 结构见 [sse-events.md](sse-events.md)；通过/失败判据见 [outcome-rules.md](outcome-rules.md)。

## 执行挂到平台调试预览会话

`debug.sh` 默认 **GET `/{devAgentId}` 取 `devConversationId`**（权威调试会话 ID），作为 `conversationId` 传给后端。沙箱注入的 `CONVERSATION_ID` 若不一致会被忽略并打 `[DEBUG]` 提示。后端把执行挂到该会话 → **用户在平台调试预览面板能实时看到调试输出**。

## 会话安全策略（避免预览串位）

`debug.sh` 发送前会查询当前 `devConversationId` 的 `taskStatus`。若会话仍为 `EXECUTING`，默认拒绝继续写入新 prompt，避免同一调试会话上一轮未结束时又追加用户消息，导致平台调试预览 tab 在续流窗口出现两条 user 气泡连贴。

推荐策略：

- **收工/回归验证默认开新会话**：`./scripts/debug.sh --new-session --message "..." --with-logs`，或先 `./scripts/session.sh new`。
- **需要上下文连续性才复用同一会话**：确保上一轮已终态，或使用 `./scripts/debug.sh --wait-idle --message "..."` 等待空闲后发送。
- **stop/cancel 后复用同会话属于高风险路径**：先 `session.sh cancel`，再 `debug.sh --wait-idle --after-stop-wait 2 ...`；干净验证仍优先 `--new-session`。
- **只在复现并发/冲突问题时强制发送**：显式加 `--allow-busy`。

## 后端依赖

前缀 `/api/v1/4sandbox/agent`，会话接口（`/conversation/*`）经沙箱重写转发到内部 `/api/agent/conversation/*`，agent 配置（`GET /{devAgentId}`）直接暴露、返回 `devConversationId`（调试会话 ID）。新建会话（`session.sh new` → `POST /conversation/create {devMode:true}`）后端会回写 `devConversationId`，平台调试预览前端轮询该字段会自动切到新会话。契约常量集中在 `scripts/debug_http.py` 顶部；完整契约见 [sse-events.md](sse-events.md)。

所有脚本由平台沙箱运行时自动配置（`PLATFORM_BASE_URL` / `SANDBOX_ACCESS_KEY` / `DEV_AGENT_ID`）；`CONVERSATION_ID` env 仅作兜底。

## 1. 发消息真实执行 — `debug.sh`

```bash
./scripts/debug.sh --message "你是谁？"                    # 执行出现在用户预览会话
./scripts/debug.sh --new-session --message "干净验证"       # 先新建调试会话再发送（收工推荐）
./scripts/debug.sh --wait-idle --message "同会话第二轮"      # 等当前会话终态后再发送
./scripts/debug.sh --allow-busy --message "并发复现"        # 强制写入 busy 会话（仅用于冲突复现）
./scripts/debug.sh --message-file prompts/test.md          # 中文/长 prompt 用 UTF-8 文件
./scripts/debug.sh --message "搜索今天的AI新闻" --expect-tool search --with-logs   # 收工：SSE + 日志双证
./scripts/debug.sh --message "测试" --auto-approve --with-logs
./scripts/debug.sh --message "第二轮" --conversation <id>  # 多轮续接
./scripts/debug.sh --message "答案" --ask-marker <requestId>          # 回答 ask-question
./scripts/debug.sh --message "测试" --show-trace --max-time 900       # 完整 trace + 总时长上限
```

| 参数 | 说明 |
|------|------|
| `--message` / `--message-file` | 调试 prompt（文本 / UTF-8 文件，二选一） |
| `--conversation` | 会话 ID（覆盖自动解析；默认 GET agent → `devConversationId`） |
| `--new-session` | 发送前新建调试会话（推荐用于干净验证；不可与 `--conversation` 同用） |
| `--wait-idle` | 当前会话仍 `EXECUTING` 时轮询等待终态再发送 |
| `--wait-idle-timeout` / `--wait-idle-interval` | `--wait-idle` 的等待超时/轮询间隔（默认 120s / 2s） |
| `--after-stop-wait` | 发送前稳定等待 N 秒，适合刚 cancel/stop 后复用同会话 |
| `--allow-busy` | 允许向 `EXECUTING` 会话继续发送（仅用于并发/冲突复现） |
| `--expect-tool` | 期望被调用的**runtime/SSE 工具名子串**（断言 `componentExecuteResults` 命中且 success；禁止中文登记名，见 flow-builder Part 3 § 三层工具名；未命中时用 `--show-trace` / `get-config --key tools --full` 修正后重跑） |
| `--auto-approve` | 自动批准权限审批（选首个 allow option） |
| `--ask-marker` | 回答 ask-question：把 `<!--nuwax-mcp-ask-request-id:<requestId>-->` 追加到 message 末尾 |
| `--variables` | 变量参数（JSON 字符串） |
| `--timeout` / `--max-time` | SSE 单次读取超时（默认 180s）/ 总时长上限（默认 600s，0=不限） |
| `--show-trace` / `--quiet` | 输出完整工具 trace / 不回显流式文本 |
| `--with-logs` | 调试结束后自动跑 `analyze-logs` 佐证；SSE 绿但日志红 → exit 4 |
| `--log-since` | `--with-logs` 时 analyze 窗口（分钟；0=按本次调试时长推算） |

**输出**：stdout = agent 文本（流式）；stderr = `[DEBUG]`/`[OUTCOME] PASS|FAIL`/`[进度]`/失败时 `[原因]`；`--with-logs` 时另有 `[日志佐证]`/`[结论]`。

## 2. 会话管理 — `session.sh`

> **新会话可直接代建**：`session.sh new` 调 `POST /conversation/create`（与 UI「刷子」等价），后端回写 `devConversationId`，平台调试预览前端轮询会自动切到新会话。改动 flow 代码后用 `new` 开干净会话验证最省事。备选：让用户手动点「刷子」后 `refresh`/`wait`。

```bash
./scripts/session.sh new                                    # 直接新建调试会话（推荐）
./scripts/session.sh new -q                                 # 仅输出新会话 ID
./scripts/session.sh refresh                                # 拉取当前 devConversationId
./scripts/session.sh wait --previous "$OLD"                 # 备选：用户手动点刷子后轮询变化
./scripts/session.sh current                                # agent 配置全文（含 devConversationId）
./scripts/session.sh cancel                                 # 取消/停止（默认自动解析 devConversationId）
./scripts/session.sh cancel --conversation <id>             # 取消指定会话
```

`session.sh cancel` 成功后，若继续同会话，请先用 `debug.sh --wait-idle` 等待后端终态稳定；若只是验证修复/收工，优先 `session.sh new` 或 `debug.sh --new-session`。

## 3. 权限审批响应 — `approve.sh`

`debug.sh` 遇 `ACP_REQUEST_PERMISSION` 未 `--auto-approve` 而 exit 5 时，用本脚本响应（option-id 来自 exit 5 列出的 options）：

```bash
./scripts/approve.sh --tool-id <toolCallId> --option-id <allow_option_id> --outcome selected    # 批准
./scripts/approve.sh --tool-id <toolCallId> --option-id <reject_option_id> --outcome cancelled  # 拒绝
```

## 4. runtime 日志佐证 — `analyze-logs.sh`

> **收工必经**：与 `debug.sh` 配对使用；单独 `[OUTCOME] PASS` 不算完成证据。

```bash
./scripts/analyze-logs.sh --since 10               # 调试后分析最近日志（推荐）
./scripts/analyze-logs.sh --session <devConversationId>
./scripts/analyze-logs.sh --dir <project-root>/.logs
./scripts/analyze-logs.sh                # 分析最新 .logs/ 日志
./scripts/analyze-logs.sh --file <path>  # 指定文件
```

stderr 须出现 **`[结论] 日志正常`**（exit 0）才可报通过；`[结论] 发现问题`（exit 4）即失败，即使 SSE 已通过。

若默认查找不到日志但你已定位到实际日志文件，必须使用 `--file <path>` 让 `analyze-logs` 产出结论；直接 `cat` 日志不算收工证据。

**日志目录约定**：开发阶段会话调试日志写入当前工作目录 / 目标项目根的 `.logs/`。`analyze-logs` 默认会找 `<cwd>/.logs` 并向上定位项目根；若从 skill 目录或其他目录执行导致误判，显式传 `--dir <项目根>/.logs` 或 `--file <实际日志文件>`。

**`[性能]` 加载耗时**：日志含 runtime 装配各阶段计时时，会额外输出 `[性能] 加载总耗时≈<n>ms | <阶段>=<n>ms | ...`（按耗时降序）。用于定位启动瓶颈（常见大头：`mcp.getTools` / `runtime.context`）。该追踪由 flow-ts 侧全局 env 开关 `PERF_TRACE` 控制，**默认开启**；无此段说明日志不含 perf 行（如已显式关闭），不影响成败判定。

## HITL 细节

| 事件 | 触发 | `debug.sh` 行为 |
|------|------|----------------|
| **权限审批** `ACP_REQUEST_PERMISSION`（或 `PROCESSING`+`subEventType=REQUEST_PERMISSION`） | agent 要执行需审批的工具 | `--auto-approve` → 自动批准首个 allow option（调 `permission-request/response`），继续流；否则 exit 5 + 列出 options（用 `approve.sh` 响应） |
| **ask-question** `PROCESSING`+`subEventType=ASK_QUESTION`（`nuwax_ask_question`） | agent 向用户提问 | exit 5 + 输出 question（requestId/title）；用 `debug.sh --message "<答案>" --ask-marker <requestId>` 续接（答案作为普通消息回流，带 marker） |

> ask-question **无专用响应端点**——答案作为普通 chat 消息回流。响应 HITL 后用**同一 `conversationId`** 续接，上下文保持。

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
