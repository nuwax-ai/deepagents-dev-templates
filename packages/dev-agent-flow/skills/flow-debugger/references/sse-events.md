# SSE 事件结构 与 后端端点契约（严格镜像平台）

## 端点契约（skill 依赖）

前缀 `/api/v1/4sandbox/agent`。会话接口（`conversation/*`）经沙箱重写（`application.yml: agent/conversation/**`）转发到内部 `/api/agent/conversation/*`；agent 配置接口直接暴露。端点常量集中在 `scripts/debug_http.py`。

| 操作 | 方法 + 路径（前缀 `/api/v1/4sandbox/agent`） | 请求体 | 关键响应 |
|------|------|------|------|
| agent 配置（取调试会话 ID） | `GET /{devAgentId}` | —（路径参=DEV_AGENT_ID） | `data.devConversationId`（调试会话 ID） |
| 发消息（SSE） | `POST /conversation/chat` | `{conversationId, message, debug:true, variableParams?, ...}` | SSE `Flux<AgentOutputDto>` |
| 新建会话（刷子） | `POST /conversation/create` | `{agentId, devMode:true, variables?}` | `data.id`（新 conversationId） |
| 会话内容/历史 | `POST /conversation/{conversationId}` | 无 body | `data.messageList[]` |
| 取消/停止 | `POST /conversation/chat/stop/{conversationId}` | 无 body（路径参=conversationId，**非** requestId） | — |
| 权限审批响应 | `POST /conversation/chat/permission-request/response` | `{conversationId, toolId, option:{optionId, outcome:'selected'\|'cancelled'}}` | — |
| 历史分页 | `POST /conversation/message/list` | `{conversationId, index, size}` | `data: MessageInfo[]` |

> 调试会话 ID = `devConversationId`：`debug.sh` / `approve.sh` / `session.sh cancel` 默认 **GET `/{devAgentId}`** 取此字段；`CONVERSATION_ID` env 仅在与 API 一致或 API 不可用时兜底。`session.sh current` 显式打印该值。

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

> **事件形态多样**：后端 SSE 的 `subType`/`subEventType` 可能在**顶层**、**data 内**或 **snake_case**（三种形态：`{eventType, data:{subType, data}}` / `{eventType, subType, data}` / `{eventType, sub_type, data}`）。`debug.py` 的 `_parse_event_envelope`（镜像平台 `parseSseEventEnvelope`）+ `_is_permission_event`/`_is_ask_question_event` 兼容全部形态，无需关心具体在哪层。

### 权限审批（识别条件对齐平台 `applyAcpPermissionSseEvent`）

任一即识别为权限审批事件：
- `eventType == ACP_REQUEST_PERMISSION`，或
- `messageType == acpRequestPermission` 且 `subType ∈ {AcpRequestPermission, request_permission}`，或
- `eventType == PROCESSING` 且（`subEventType == REQUEST_PERMISSION` 或 `name 含 RequestPermission` 或存在 `request_permission_request`）

`data`（兼容 camelCase/snake_case）含：
- `request_permission_request.{toolCall:{toolCallId, kind, title, rawInput}, options:[{optionId, kind:allow_once|allow_always|reject_once|reject_always, name}]}`
- 顶层 `tool_call_id` / `toolCallId` / `executeId`
- **响应 ID = `tool_call_id`（toolId）**；批准 `outcome=selected`，拒绝 `outcome=cancelled`
- 响应端点：`/conversation/chat/permission-request/response`（**非** `/api/computer/notify-resolved`，后者是平台内部通道）

### ask-question（`PROCESSING` + `subEventType=ASK_QUESTION`，`nuwax_ask_question` 工具）

`data.result.data` = `McpAskUserToolInput`：
- `{toolName:'nuwax_ask_question', schemaVersion:'nuwax.mcp_ask.v2', requestId, sessionId, title, description?, ui:{fields,steps,presentation,submitLabel}}`
- `toolCallId = result.data.requestId || executeId`
- **无专用响应端点**：答案作为普通 chat 消息回流（`message` + 末尾 marker `<!--nuwax-mcp-ask-request-id:<requestId>-->`）→ 用 `debug.sh --message "<答案>" --ask-marker <requestId>` 续接

## 给后端的约束（影响 skill 能力）

1. **直接调 `conversationApplicationService.chat()`，勿走 `IAgentRpcService.executeAgent()`** —— 后者（`AgentApiServiceImpl.java:1369-1371`）把 FINAL_RESULT 映射成纯 `outputText`，丢弃 `componentExecuteResults`（为 MCP 设计），会让 skill 工具断言失效。参考 `ConversationController.java:256` / `ApiController.java:158`。
2. **`devMode=true`**：`chat(req, headers, false, true)`（4 参重载，`ConversationApplicationService.java:134`）。
3. **`conversationId` 挂用户预览会话**：用 `devConversationId`（`GET /{devAgentId}` 权威来源；勿盲信沙箱 `CONVERSATION_ID`）；devMode 下平台用之作 DevDebug 会话，执行消息写入 → 用户 agent-dev 预览面板可见。
4. **认证复用 Sandbox AK**：`/api/v1/4sandbox/**` 在 JWT 白名单 + Sandbox AK 放行（`ApiKeyInterceptor.java:173` + `application.yml:70`），无需用户 JWT。
5. **子路径镜像平台**：4sandbox 下的子路径与平台 `/api/agent/conversation/*` 一致（`chat` / `create` / `{id}` / `chat/stop/{id}` / `chat/permission-request/response`），仅前缀不同；`cancel` 路径参是 `conversationId` 不是 requestId。
