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
| `title` / `kind` | `toolInfoFromToolEvent`（terminal 也带） | Backend 用 `title.contains("nuwax_ask_question")` 合成 `ASK_QUESTION`；NuwaClaw 可能只转发 completed（in_progress 被 permissionGatedToolUpdate delay）→ terminal 必须自带 title |
| `rawInput` | `inflightTools` 回填 / MCP `structuredContent.input` | completed 优先 MCP 结构化输入 |
| `rawOutput` | `preserveRawOutput` / MCP `structuredContent` | 原貌优先 |
| `content` | `toolUpdateFromToolResult` | read 全文 `markdownEscape`；MCP 通用文本；failed = 错误文本 |
| `input` / `output` | **不发** | 2026-06-27 已移除双写 |

展示逻辑：[`acp-tool-presentation.ts`](../../../../../packages/deepagents-flow-ts/src/libs/deepagents-acp/acp-tool-presentation.ts)  
出站入口：[`emit-tool-call.ts`](../../../../../packages/deepagents-flow-ts/src/surfaces/acp/emit-tool-call.ts)

---

## 双轨去重（`emit-tool-call.ts`）

`createToolExecNode`（节点直出）与 LangGraph `tools` stream（`on_tool_start`/`on_tool_end`）会对**同一 `toolCallId`** 各触发一次 `onToolCall` → 两路都进 `emitToolCall`。两个 `Set` 各管一端：

| 去重集 | 拦截 | 行为 | 根因 |
| --- | --- | --- | --- |
| `emittedToolCallIds` | 二次 **in_progress** | 改发 `tool_call_update`（status `in_progress`）精炼 rawInput，不再发第二个 `tool_call` | C-dedupe（对齐参考实现 `alreadyCached`） |
| `completedToolCallIds` | 二次 **terminal**（completed/failed） | **跳过**（直接 return） | 节点直出的 terminal（带完整 rawInput + result）先到；stream `on_tool_end` 的冗余 terminal 后到且**缺 rawInput**（dispatch `tool_update` 不带 input）→ 若不跳过，无 rawInput 的第二个 completed 会覆盖首个，ask-question dockpanel 丢 `rawInput.ui` |

> `dispatch-surface-event.ts` 另有一道防线：`tool_update` completed 且 `output===undefined` 时直接 break，不发空 completed。两道防线互补。

---

## 其他 sessionUpdate

- `agent_message_chunk` / `agent_thought_chunk`：`ContentChunk` ✅  
- `plan`：`emitPlan` 透传 `PlanEvent.entries` ✅
