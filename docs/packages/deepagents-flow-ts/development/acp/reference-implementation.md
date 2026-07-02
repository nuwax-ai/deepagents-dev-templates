# 参考实现：nuwax-ai/claude-code-acp-ts 完整度对照

[← 返回索引](./README.md) · [追赶进度](./roadmap-progress.md)

[NuwaX 维护的 claude-code-acp-ts](https://github.com/nuwax-ai/claude-code-acp-ts) fork 自 [Zed 上游](https://github.com/agentclientprotocol/claude-agent-acp)，与 **NuwaClaw 宿主同一套 ACP 出站习惯**，是 flow-ts 对齐的**首选参照**。

维护时：**先对照 NuwaX fork 的 `acp-agent.ts` / `tools.ts`**，再用 [官方 v1 schema](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v1/schema.json) 校验。

---

## 仓库对照

| 项 | nuwax-ai/claude-code-acp-ts | deepagents-flow-ts |
| --- | --- | --- |
| 仓库 | [github.com/nuwax-ai/claude-code-acp-ts](https://github.com/nuwax-ai/claude-code-acp-ts) | `packages/deepagents-flow-ts` |
| 默认分支 | `feat/claude-code-acp-ts` | — |
| 上游 | [agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) | — |
| 本地路径 | `~/workspace/claude-code-acp-ts` | — |
| SDK | `@agentclientprotocol/sdk@0.25.0` | `^0.24.0` |
| 核心文件 | `src/acp-agent.ts`、`src/tools.ts` | `acp-tool-presentation.ts` + `emit-tool-call.ts` |
| 测试标杆 | `src/tests/tools.test.ts`（rawOutput 专测） | `tests/acp-emit-tool-call.test.ts` |

```bash
git clone https://github.com/nuwax-ai/claude-code-acp-ts.git ~/workspace/claude-code-acp-ts
cd ~/workspace/claude-code-acp-ts && git checkout feat/claude-code-acp-ts
```

---

## `session/update` 类型完整度

| sessionUpdate | 官方 v1 | claude-code-acp-ts | flow-ts | 说明 |
| --- | --- | --- | --- | --- |
| `agent_message_chunk` | ✅ | ✅ | ✅ | `ContentChunk` |
| `agent_thought_chunk` | ✅ | ✅ | ✅ | stage → thought |
| `user_message_chunk` | ✅ | ✅ | ❌ | flow 不回放用户 chunk |
| `tool_call` | ✅ | ✅ | ✅ | 见下节 |
| `tool_call_update` | ✅ | ✅ | ✅ | 见下节 |
| `plan` | ✅ | ✅ | ✅ | |
| `usage_update` | ✅ | ✅ | ❌ | ⏸️ 暂缓 |
| `available_commands_update` | ✅ | ✅ | ❌ | ⏸️ 暂缓（Legacy 部分有） |
| `current_mode_update` | ✅ | ✅ | ❌ | ⏸️ 暂缓 |
| `config_option_update` | ✅ | ✅ | ❌ | ⏸️ 暂缓 |
| `session_info_update` | ✅ | ❌ | ❌ | |

---

## 工具调用字段对照

官方 **只有** `rawInput` / `rawOutput`，**没有**顶层 `input` / `output`。

| 行为 | claude-code-acp-ts | flow-ts | 跟进 |
| --- | --- | --- | --- |
| 创建工具 | `tool_call` + `rawInput`，`status: "pending"` | `rawInput`，`in_progress` | ✅ 核心已对齐 |
| 增量输入 | 二次 `tool_call_update` + `rawInput` | 只发一次 | 阶段 C |
| 权限请求 | `requestPermission` + `rawInput` | ✅ `buildPermissionToolCall` | |
| 完成结果 | `rawOutput` 原貌 + `toolUpdateFromToolResult` | ✅ presentation | |
| 文件工具 | `locations` + `diff` | ✅ presentation | |
| Bash 终端 | `_meta.terminal_*` | 无 | 暂不做了 |
| 非官方字段 | 从不发 | ✅ 已移除双写 | |

### 参考代码锚点

```typescript
// tool_call 首包 — acp-agent.ts ~L3619
{ sessionUpdate: "tool_call", toolCallId, rawInput, status: "pending", ...toolInfoFromToolUse() }

// tool_call_update 完成 — acp-agent.ts ~L3703
{ sessionUpdate: "tool_call_update", toolCallId, status: "completed"|"failed",
  rawOutput: chunk.content, ...toolUpdateFromToolResult() }

// requestPermission — acp-agent.ts ~L2029
toolCall: { toolCallId, rawInput: toolInput, ...toolInfoFromToolUse() }
```

### flow-ts 最低标准

1. `tool_call` / `tool_call_update` 必须带 **`rawInput`**（含 MCP `ui`）
2. completed 必须带 **`rawOutput`** 和/或 合规 **`content[]`**
3. 不向严格客户端依赖 **`input`/`output`**
4. `content` 嵌套：`{ type:"content", content: ContentBlock }`

---

## Agent 方法（session 生命周期）

| 方法 | claude-code-acp-ts | flow-ts |
| --- | --- | --- |
| `initialize` | ✅ | ✅ |
| `session/new` | ✅ | ✅ + `configureSession(phase:new)` |
| `session/load` | ✅ | ⚠️ 重建 `SessionState` + `configureSession(phase:load)` ✅；**`getSessionHistory` 消息回放未实现**（Legacy server 调 hook @ `server.ts:1192`，但 Flow surface 的 `createFlowHooks` 未提供，仅 TODO） |
| `session/prompt` | ✅ | ✅（`onPrompt` → Flow） |
| `session/cancel` | ✅ | ✅（abort signal 透传进图 + `failInflightToolsOnCancel`） |
| `session/set_mode` | ✅ | ❌ |
| `session/set_config_option` | ✅ | ❌ |
| `session/list` / `delete` / … | 部分 | 依 DeepAgentsServer |

---

## 可复用模式

| 模式 | 参考位置 | flow-ts |
| --- | --- | --- |
| `toolUpdateFromToolResult` 按工具名分支 | `tools.ts` | ✅ `acp-tool-presentation.ts` |
| `alreadyCached` 精炼 rawInput | `acp-agent.ts` | 阶段 C |
| `rawOutput` 单测矩阵 | `tests/tools.test.ts` | ✅ `acp-tool-presentation.test.ts` |

---

## 完整度评分（维护用）

| 维度 | claude-code-acp-ts | flow-ts |
| --- | --- | --- |
| ToolCall 核心字段 | ★★★★★ | ★★★★★ |
| session/update 广度 | ★★★★☆ | ★★★☆☆ |
| 权限 request_permission | ★★★★★ | ★★★★☆ |
| 终端 / diff / locations | ★★★★☆ | ★★★★☆ |
| 单测覆盖 | ★★★★★ | ★★★★☆ |

**维护原则**：不必追平全部 Zed 特性，但 **工具出站必须与 v1 schema + 参考实现一致**，否则平台客户端会丢字段（如 ask-question **平台问答卡片**所需的 `rawInput.ui`）。
