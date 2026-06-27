# 端到端数据流（Flow → NuwaClaw）

[← 返回索引](./README.md)

---

## MCP 标准栈（LangGraph + MCP 官方接入）

本包 **不** 自研 MCP JSON-RPC，也不手写 tools/call。三层官方栈：

| 层 | 包 / API | 职责 |
| --- | --- | --- |
| **LangGraph** | `ToolNode` / `createToolExecNode` · `bindTools` · `streamMode: "tools"` | MCP 工具作为 native `StructuredTool` 进图；`on_tool_*` 经 callbacks → ACP |
| **LangChain 适配** | [`@langchain/mcp-adapters`](https://github.com/langchain-ai/langchain-mcp-adapters) `MultiServerMCPClient.getTools()` | MCP server → LangChain `StructuredTool[]`（`prefixToolNameWithServerName`） |
| **MCP 协议** | [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) `Client` | `tools/list`、`tools/call`；`CallToolResult.content` + `structuredContent` |
| **配置** | `config/mcp.default.json` + ACP `session/new` `mcpServers` | session-wins 合并 |

```mermaid
flowchart TB
  Config[mcp.default.json + ACP mcpServers]
  Adapters["@langchain/mcp-adapters\nMultiServerMCPClient.getTools()"]
  SDK["@modelcontextprotocol/sdk\nClient.callTool"]
  LG["LangGraph\nToolNode / bindTools / tools stream"]
  ACP["ACP emit-tool-call\nrawInput / rawOutput"]

  Config --> Adapters --> SDK
  Adapters --> LG
  LG --> ACP
```

**LangGraph 侧入口**（与 [LangChain MCP 文档](https://docs.langchain.com/oss/javascript/langchain/mcp) 一致）：

1. [`hydrateRuntimeContext()`](../../../../../packages/deepagents-flow-ts/src/runtime/context/runtime-context.ts) — `client.getTools()` → `ctx.mcpTools`
2. [`flow-tools.ts`](../../../../../packages/deepagents-flow-ts/src/app/flow-tools.ts) — 合并进 `allTools` → think `bindTools`
3. [`createToolExecNode`](../../../../../packages/deepagents-flow-ts/src/libs/nodes/tools.ts) — 包装 `@langchain/langgraph/prebuilt` `ToolNode`
4. [`map-stream-chunk.ts`](../../../../../packages/deepagents-flow-ts/src/surfaces/map-stream-chunk.ts) — `streamMode: "tools"` → `on_tool_start` / `on_tool_end`

工具结果：`CallToolResult.structuredContent` → ACP `rawOutput`；`structuredContent.input` → ACP `rawInput`（[`tool-result-normalize.ts`](../../../../../packages/deepagents-flow-ts/src/libs/nodes/tool-result-normalize.ts)）。

---

```mermaid
sequenceDiagram
  participant Graph as LangGraph ReAct
  participant Node as createToolExecNode
  participant Stream as map-stream-chunk
  participant Dispatch as dispatch-surface-event
  participant Emit as emit-tool-call
  participant Host as NuwaClaw acpUpdateMapper
  participant Web as Nuwax Web

  Graph->>Node: ToolNode 执行
  Node->>Dispatch: configurable.onToolCall
  Graph->>Stream: tools on_tool_end
  Stream->>Dispatch: tool_update
  Dispatch->>Emit: ToolCallEvent
  Emit->>Host: session/update rawInput/rawOutput
  Host->>Web: message.part.updated input=rawInput
  Web->>Web: AskQuestion dockpanel 读 input.ui
```

---

## 内部事件契约：`ToolCallEvent`

定义：[`src/core/flow-types.ts`](../../../../../packages/deepagents-flow-ts/src/core/flow-types.ts)

| 阶段 | `status` | 映射到 ACP |
| --- | --- | --- |
| 开始 | `in_progress` | `tool_call` + `rawInput` |
| 成功 | `completed` | `tool_call_update` + `rawOutput` + `content` |
| 失败 | `failed` | `tool_call_update` + `content`（错误文本） |

---

## 会话配置：session/new|load → per-session runtime

`session/new` / `session/load` 经 `configureSession` 钩子把 ACP 下发的 `cwd` / `mcpServers` / `model` / `systemPrompt` 装配成**每会话独立** runtime（ACP 最高优先级），`onSessionClosed` 释放（MCP stdio 子进程）。两层协作：

| 职责 | 文件 | 说明 |
| --- | --- | --- |
| 解析 + 合并 | [`surfaces/acp/session-config.ts`](../../../../../packages/deepagents-flow-ts/src/surfaces/acp/session-config.ts) | `resolveAcpSessionConfig` = `loadSessionConfigFromEnv` ⊕ `sessionConfigFromParams`（params 优先）→ `ACPSessionConfig` |
| 诊断日志 | [`surfaces/acp/session-diagnostics.ts`](../../../../../packages/deepagents-flow-ts/src/surfaces/acp/session-diagnostics.ts) | `logStartupAcpEnvDiagnostics` / `logConfigureSessionDiagnostics`：记 systemPrompt 来源、MCP server command/args 快照（env 值不记、敏感项脱敏） |
| 装配 / 释放 | [`surfaces/acp/server.ts`](../../../../../packages/deepagents-flow-ts/src/surfaces/acp/server.ts) `createFlowHooks` | `configureSession`→`createExecutor` 建 per-session runtime；`onSessionClosed`→`dispose` |

**systemPrompt 解析管线**（`coalesceSystemPromptValue` 归一为纯文本，按优先级）：

1. params 顶层 `systemPrompt` / `system_prompt`
2. `params.configOptions.systemPrompt`
3. `params._meta.systemPrompt` / `_meta.system_prompt` —— **nuwaclaw** 走 `_meta.systemPrompt = { append: "..." }`（`extractFromMeta` 递归 `_meta.sessionConfig` / `_meta.agentConfig` / `_meta.claudeCode.options`）
4. env `ACP_SESSION_CONFIG_JSON`（JSON）
5. env `SYSTEM_PROMPT` / `AGENT_SYSTEM_PROMPT` / `PLATFORM_SYSTEM_PROMPT`

> `mcpServers` 数组形态 `[{name,...}]` 经 `acpMcpToRecord` → Record；server 键名经 `sanitizeMcpServerRecord` 规范化（中文等 → `_`），与 runtime-context 合并一致。

**session/load**：重建 `SessionState` + 触发 `configureSession(phase:"load")`（[acp-load-session-hydrate.test.ts](../../../../../packages/deepagents-flow-ts/tests/acp-load-session-hydrate.test.ts) 覆盖）。注意 Flow surface **尚未实现** `getSessionHistory` 消息回放（见 [reference-implementation.md §Agent 方法](./reference-implementation.md#agent-方法session-生命周期)）。

---

## 工具结果来源（双轨，注意去重）

| 来源 | 文件 | 说明 |
| --- | --- | --- |
| 节点直出 | `libs/nodes/tools.ts` → `configurable.onToolCall` | 推荐；args 完整 |
| Stream | `map-stream-chunk.ts` → `dispatch-surface-event.ts` | `on_tool_end` 解析；`output===undefined` 的 completed **跳过** |

`buildAcpCallbacks` 用 `inflightTools: Map<toolCallId, ToolCallEvent>` 在 completed 时回填 `rawInput`，并持两个去重集（`emittedToolCallIds` / `completedToolCallIds`）拦双轨重复出站，详见 [field-mapping.md §双轨去重](./field-mapping.md#双轨去重emit-tool-callts)。

---

## NuwaClaw 宿主契约（非 ACP 官方，但生产必知）

| 层级 | 行为 |
| --- | --- |
| `acpUpdateMapper` | `tool_call` / `tool_call_update` 只映射 **`rawInput` / `rawOutput`**，不读 `input` |
| Web / Backend | `Backend.Sandbox.Event.AskQuestion` 需 `rawInput` 含 **`schemaVersion` + `toolName` + `ui.version`**（MCP 服务端补齐） |
| MCP→ACP 通用约定 | `CallToolResult.structuredContent` → ACP `rawOutput`；`structuredContent.input` → ACP `rawInput`（交互式工具） |
| ask-question 实例 | 见 nuwaclaw `docs/mcp-ask-question-acp-toolcall-v1.md` |

**历史故障**：
- 仅发 `input` 不发 `rawInput` → 宿主 `input=null`（2026-06 已修）
- 只回填 LLM args、丢弃 MCP `structuredContent.input` → 缺 `ui.version` → 只出 `ToolCall` 不出 `AskQuestion` Event（2026-06-27 已修）
