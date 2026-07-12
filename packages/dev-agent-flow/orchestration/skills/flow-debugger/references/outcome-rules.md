# 通过/失败判定规则

`debug.sh` 收完 SSE 事件流后，由 `debug.py` 的 `judge_outcome()` 判定 SSE 侧成败；**收工还须 runtime 日志佐证**（`--with-logs` 或紧接 `analyze-logs.sh`）。二者缺一不得报完成。

## 日志佐证门禁（收工必经）

| 条件 | 判定 |
|------|------|
| `debug.sh` exit 0 **且** `analyze-logs` exit 0（`[结论] 日志正常`） | **可报通过** |
| `debug.sh` exit 0 **但** `analyze-logs` exit 4（日志有错误/失败工具/flow 异常） | **FAIL**（假绿） |
| `debug.sh` exit 0 **但** 找不到日志（analyze exit 3） | **FAIL**（无佐证） |
| `debug.sh` exit 4 | **FAIL**（SSE 未通过；仍建议跑 analyze 辅助定位） |

推荐：`debug.sh --with-logs` 在 SSE 判定后自动跑 analyze，SSE 绿但日志红 → 统一 exit 4。

## SSE 判定（`judge_outcome`）

判定逻辑借鉴
旧本地 smoke 判定器（已移除）中的 `isSmokeFlowSuccess` + `evaluateExpectedTool`，
但数据源是结构化的 `AgentExecuteResult`（非文本日志解析），更直接可靠。

## 判定顺序（任一命中即 FAIL）

### 1. 有错误 → FAIL
- 收到 `ERROR` 事件，或
- `FINAL_RESULT.error` 非空

reason = 错误内容。

### 2. 文本输出为空 → FAIL
- `outputText` 为空 **且** 无任何 MESSAGE 文本片段

> 对应 smoke 的 `isSmokeFlowSuccess`：flowStatus=done 需 outputChars/answerChars > 0。
> 真实调试中等价于"agent 必须有非空文本回复"。

### 3. 工具调用断言（仅 `--expect-tool` 时）
断言 `componentExecuteResults` 中存在名称含 `expect`（大小写不敏感子串）的工具调用，且：
- **被调用**：至少一项名称匹配。否则 FAIL（`期望工具未被调用`）。
- **成功**：匹配项 `success=true`。若有 `success=false` → FAIL（`工具调用失败`）。
- **非空结果**：匹配项 `data` 非空。若全部成功但 `data` 为空 → FAIL（`调用成功但返回为空`）。

> 对应 smoke 的 `evaluateExpectedTool`：工具须出现、至少一次 done、结果非空、无 failed。
> 这条是"平台能力真实调用"闸门——防止 LLM 兜底输出造成假绿。

### 4. 全部不命中 → PASS

## 错误聚合定位（FAIL 时输出到 stderr）

`aggregate_error_context()` 把失败原因结构化分段：

- `[执行错误]` — `FINAL_RESULT.error`
- `[流错误]` — `ERROR` 事件
- `[工具失败]` — `success=false` 的工具调用（含其 error）
- `[工具空结果]` — `success=true` 但 `data` 为空的工具调用
- `[工具摘要]` — 共 N 次调用, M 次失败

## 退出码

| 码 | 含义 | 触发 |
|----|------|------|
| 0 | 通过 | outcome PASS |
| 1 | 参数错误 | `--message`/`--message-file` 缺失或空；`--variables` 非 JSON |
| 2 | 平台未就绪 | 沙箱 env（`PLATFORM_BASE_URL`/`SANDBOX_ACCESS_KEY`/`DEV_AGENT_ID`）缺失 |
| 3 | HTTP/SSE 失败 | 连接失败 / HTTP 非 2xx（含后端端点 404 未就绪）/ 超时 / 流异常中断 |
| 4 | 调试不通过 | outcome FAIL（上述判定 1/2/3 命中） |
| 5 | 遇 HITL 待人工响应 | 权限审批未 `--auto-approve`；ask-question（用 `approve.sh` / `--ask-marker` 响应后续接） |

## 与旧本地 smoke 的判定对照

| 维度 | 旧本地判定 | `flow-debugger` |
|------|--------------------------|------------------|
| 数据源 | rcoder 日志文本解析（flowStatus/outputChars） | 结构化 `AgentExecuteResult` |
| 文本非空 | `outputChars/answerChars > 0` | `outputText` 非空 |
| 工具断言 | `tool invoke done` + `resultChars > 0` | `componentExecuteResults[].success` + `data` 非空 |
| HITL | flowStatus=interrupted + questionChars | exit 5 + `--auto-approve`/`approve.sh`（权限）+ `--ask-marker`（ask-question 续接） |
| 链路 | 本地 rcoder 模拟 | 平台真实 agent 执行（用户预览可见） |
