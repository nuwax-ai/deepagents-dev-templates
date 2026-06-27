# 官方 schema ↔ 实现对照（Flow 主路径）

[← 返回索引](./README.md)

---

## `session/update` 类型一览

| sessionUpdate | 实现位置 | 状态 |
| --- | --- | --- |
| `agent_message_chunk` | `server.ts` → `streamText` | ✅ |
| `agent_thought_chunk` | `server.ts` → `streamText`（stage） | ✅ |
| `tool_call` | `emit-tool-call.ts` + `acp-tool-presentation.ts` | ✅ |
| `tool_call_update` | 同上 | ✅ |
| `plan` | `server.ts` → `emitPlan` | ✅ |

---

## `tool_call`（创建工具调用）

**官方无**：顶层 `input` / `output`（本实现**不发**）

| 字段 | Flow 实现 | 备注 |
| --- | --- | --- |
| `toolCallId` | `e.toolCallId` | |
| `title` / `kind` | `toolInfoFromToolEvent` | |
| `status` | `"in_progress"` | |
| `rawInput` | `e.args` | ask-question / NuwaClaw |
| `locations` | `extractToolCallLocations`（经 presentation） | read/write/edit/grep 等 |
| `content` | write/edit 发 `type:"diff"` | 见 presentation |

---

## `tool_call_update`（工具进度 / 结果）

| 字段 | Flow 实现 | 备注 |
| --- | --- | --- |
| `rawInput` | `inflightTools` 回填 | |
| `rawOutput` | `preserveRawOutput` / MCP `structuredContent` | 原貌优先 |
| `content` | `toolUpdateFromToolResult` | read 全文 `markdownEscape`；MCP 通用文本 |
| `input` / `output` | **不发** | 2026-06-27 已移除双写 |

展示逻辑：[`acp-tool-presentation.ts`](../../../../../packages/deepagents-flow-ts/src/libs/deepagents-acp/acp-tool-presentation.ts)  
出站入口：[`emit-tool-call.ts`](../../../../../packages/deepagents-flow-ts/src/surfaces/acp/emit-tool-call.ts)

---

## 其他 sessionUpdate

- `agent_message_chunk` / `agent_thought_chunk`：`ContentChunk` ✅  
- `plan`：`emitPlan` 透传 `PlanEvent.entries` ✅
