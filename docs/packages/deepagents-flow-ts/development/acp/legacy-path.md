# Legacy 路径：`libs/deepagents-acp`

[← 返回索引](./README.md)

文件：[`server.ts`](../../../../../packages/deepagents-flow-ts/src/libs/deepagents-acp/server.ts)（`@ts-nocheck`）

| 方法 | 状态（2026-06-27） | 实现 |
| --- | --- | --- |
| `sendToolCall` | ✅ 已对齐 | `rawInput` + `toolInfoFromToolEvent`（locations/diff） |
| `sendToolCallUpdate` | ✅ 已对齐 | `rawOutput` + `toolUpdateFromToolResult` |
| `requestToolPermission` | ✅ 已对齐 | `buildPermissionToolCall`（`rawInput`，无 `input`） |

共用模块：[`acp-tool-presentation.ts`](../../../../../packages/deepagents-flow-ts/src/libs/deepagents-acp/acp-tool-presentation.ts)

---

## 维护策略

- Flow 生产路径仍**只走** `surfaces/acp`（`onPrompt` 短路）
- Legacy 与 Flow **必须**共用 `acp-tool-presentation.ts`，避免字段再次分叉
- 新工具展示规则：改 presentation，同时覆盖 Flow `emit-tool-call` 与 Legacy `sendToolCall*`
