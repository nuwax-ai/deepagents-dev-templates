# SSE 事件结构 与 后端端点契约（严格镜像 nuwax）

## 端点契约（skill 依赖）

skill 严格镜像 nuwax 前端 `/api/agent/conversation/*` 子路径，仅前缀换到 4sandbox。端点常量集中在 `scripts/debug_http.py`（后端 ready 后若子路径有差异只改那里）。

| 操作 | 方法 + 路径（前缀 `/api/v1/4sandbox/agent/dev`） | 请求体 | 关键响应 |
|------|------|------|------|
| 发消息（SSE） | `POST /conversation/chat` | `{conversationId, message, debug:true, variableParams?, ...}` | SSE `Flux<AgentOutputDto>` |
| 新建会话（刷子） | `POST /conversation/create` | `{agentId, devMode:true, variables?}` | `data.id`（新 conversationId） |
| 会话内容/历史 | `POST /conversation/{conversationId}` | 无 body | `data.messageList[]` |
| 取消/停止 | `POST /conversation/chat/stop/{conversationId}` | 无 body（路径参=conversationId，**非** requestId） | — |
| 权限审批响应 | `POST /conversation/chat/permission-request/response` | `{conversationId, toolId, option:{optionId, outcome:'selected'\|'cancelled'}}` | — |
| 历史分页 | `POST /conversation/message/list` | `{conversationId, index, size}` | `data: MessageInfo[]` |

> `devConversationId` 由沙箱 `CONVERSATION_ID` env 提供（= 业务 Agent 的 `devAgentConversationId`），无需另调 `GET /api/agent/{agentId}`。

## SSE 事件（外层信封 ConversationChatResponse：`{eventType, data, error, requestId, completed}`）

| eventType | data | skill 处理 |
|-----------|------|-----------|
| `HEART_BEAT` | — | 忽略（保活） |
| `PROCESSING` | `ProcessingData`（含 `subEventType`、`result`） | `subEventType=REQUEST_PERMISSION`→权限审批；`ASK_QUESTION`→ask-question；其余忽略 |
| `MESSAGE` | `ConversationChatMessage`（`{text, type:CHAT\|THINK\|GUID\|QUESTION\|ANSWER, finished, ...}`） | 提取 `text` 累加/流式回显 |
| `FINAL_RESULT` | `ConversationFinalResult`（见下） | **核心数据源**；终止流 |
| `ERROR` | — | 收集错误；终止流 |
| `ACP_REQUEST_PERMISSION` | `request_permission_request`（见下） | 权限审批 HITL |

终止信号：`FINAL_RESULT` / `ERROR` / `completed=true` / `subType=end_turn`。

## FINAL_RESULT.data = ConversationFinalResult

```json
{
  "success": true,
  "error": null,
  "outputText": "Agent 完整文本回复",
  "componentExecuteResults": [
    {"name": "工具名", "type": "Plugin|Workflow|...", "success": true, "error": null,
     "data": "工具返回", "input": "工具入参", "startTime": "...", "endTime": "..."}
  ],
  "startTime": "...", "endTime": "...",
  "promptTokens": 0, "completionTokens": 0, "totalTokens": 0
}
```

skill 从中提取：文本回复 → `outputText`；工具调用 trace → `componentExecuteResults[]`；错误 → `error`/`success=false`。

## HITL 事件结构

### 权限审批（`ACP_REQUEST_PERMISSION`，或 `PROCESSING`+`subEventType=REQUEST_PERMISSION`）

`data`（兼容 camelCase/snake_case）含：
- `request_permission_request.{toolCall:{toolCallId, kind, title, rawInput}, options:[{optionId, kind:allow_once|allow_always|reject_once|reject_always, name}]}`
- 顶层 `tool_call_id` / `toolCallId` / `executeId`
- **响应 ID = `tool_call_id`（toolId）**；批准 `outcome=selected`，拒绝 `outcome=cancelled`
- 响应端点：`/conversation/chat/permission-request/response`（**非** `/api/computer/notify-resolved`，后者是 nuwax 内部通道）

### ask-question（`PROCESSING` + `subEventType=ASK_QUESTION`，`nuwax_ask_question` 工具）

`data.result.data` = `McpAskUserToolInput`：
- `{toolName:'nuwax_ask_question', schemaVersion:'nuwax.mcp_ask.v2', requestId, sessionId, title, description?, ui:{fields,steps,presentation,submitLabel}}`
- `toolCallId = result.data.requestId || executeId`
- **无专用响应端点**：答案作为普通 chat 消息回流（`message` + 末尾 marker `<!--nuwax-mcp-ask-request-id:<requestId>-->`）→ 用 `debug.sh --message "<答案>" --ask-marker <requestId>` 续接

## 给后端的约束（影响 skill 能力）

1. **直接调 `conversationApplicationService.chat()`，勿走 `IAgentRpcService.executeAgent()`** —— 后者（`AgentApiServiceImpl.java:1369-1371`）把 FINAL_RESULT 映射成纯 `outputText`，丢弃 `componentExecuteResults`（为 MCP 设计），会让 skill 工具断言失效。参考 `ConversationController.java:256` / `ApiController.java:158`。
2. **`devMode=true`**：`chat(req, headers, false, true)`（4 参重载，`ConversationApplicationService.java:134`）。
3. **`conversationId` 挂用户预览会话**：用请求传入的 `conversationId`（= `CONVERSATION_ID` env = `devAgentConversationId`）；devMode 下平台用之作 DevDebug 会话（`ConversationApplicationServiceImpl.java:308-312`），执行消息写入 → 用户 agent-dev 预览面板可见。
4. **认证复用 Sandbox AK**：`/api/v1/4sandbox/**` 在 JWT 白名单 + Sandbox AK 放行（`ApiKeyInterceptor.java:173` + `application.yml:70`），无需用户 JWT。
5. **子路径镜像 nuwax**：4sandbox 下的子路径与 nuwax `/api/agent/conversation/*` 一致（`chat` / `create` / `{id}` / `chat/stop/{id}` / `chat/permission-request/response`），仅前缀不同；`cancel` 路径参是 `conversationId` 不是 requestId。
