# ACP 对齐变更记录

[← 返回索引](./README.md)

| 日期 | 变更 |
| --- | --- |
| 2026-06-27 | 初版：梳理官方 schema vs Flow/Legacy 双路径；记录 rawInput/rawOutput 对齐与 ask-question 故障根因 |
| 2026-06-27 | 实现：`emit-tool-call.ts`、`tool-result-normalize.ts`；`createToolExecNode` 读 `configurable.onToolCall` |
| 2026-06-27 | 补充官方 schema v1/v2 链接；新增与 nuwax-ai/claude-code-acp-ts 完整度对照 |
| 2026-06-27 | 参考实现改为 [nuwax-ai/claude-code-acp-ts](https://github.com/nuwax-ai/claude-code-acp-ts) |
| 2026-06-27 | 文档拆分为 `development/acp/` 多文件；新增 roadmap-progress.md |
| 2026-06-27 | **实施 A+B+D**：`acp-tool-presentation.ts`；locations/diff/rawOutput 原貌；移除 input/output 双写；`buildPermissionToolCall` |
| 2026-06-27 | **C-dedupe**：`emittedToolCallIds`；二次 in_progress → `tool_call_update` |
| 2026-06-27 | **ask-question dockpanel**：completed 优先 `structuredContent.input`；`createToolExecNode` 保留 MCP structuredContent |
| 2026-06-27 | 文档：MCP 标准栈补充 LangGraph + mcp-adapters + typescript-sdk 三层 |
| 2026-06-22 | 会话配置迁移到 surfaces：`session-config.ts` 解析 `_meta.systemPrompt.append`（nuwaclaw）+ env 管线（1d5b791b） |
| 2026-06-25 | `session-diagnostics.ts`：MCP server command/args 快照 + 敏感项脱敏；systemPrompt 来源诊断（5dc39c80 / 6bdfbb31） |
| 2026-06-27 | `emit-tool-call.ts`：terminal `tool_call_update` 携带 `title`/`kind`（Backend 用 title 合成 ASK_QUESTION；NuwaClaw 可能只转发 completed） |
| 2026-06-27 | **双轨去重双端**：`emittedToolCallIds`（二次 in_progress→`tool_call_update`）+ `completedToolCallIds`（二次 terminal→跳过，防无 rawInput 的 completed 覆盖首包 ask-question.ui）（bf7476a6） |
| 2026-06-27 | 文档同步：补 terminal title/kind、双轨去重、会话配置解析管线、per-session runtime；修正 `session/load` + `getSessionHistory` 过声称；源码索引/测试表补 session-config/diagnostics 等 4 测试 |
| 2026-06-27 | **Flow 工具权限审批（A）**：`onPermissionRequest` 同步门控（A2：拒绝合成 error ToolMessage 让 ToolNode 跳过执行）→ `createAcpPermissionHandler` 经 `conn.requestPermission`；复用 `permissions.mode`/`interruptOn`（默认补 `bash`/`http_request`）+ per-session always 缓存 + signal race + graceful 降级；`tests/acp-permission-gating.test.ts`（15 例）、[permission.md](./permission.md) |
| 2026-06-27 | 文档：新增 [human-in-the-loop.md](./human-in-the-loop.md) —— HITL 总览（工具审批 A vs 审批节点 B、两通道、职责划分、A 时序缺陷记录） |
| 2026-06-27 | **确认 NuwaClaw 审批中枢 + 移除 agent 侧 always 缓存**：实证 NuwaClaw 已实现 `session/request_permission`（`agent-electron-client` `permissionCoordinator` 决策链 + `approvalInterventionService`）；据此删 flow-ts 的 `permissionCache`/sticky（agent 每次对 interruptOn 工具发请求，规则/strict 校验/审计交 client 中枢，对齐 claude-code-acp）；`callAcpPermission` 返回简化为 `PermissionDecision` |
| 2026-06-27 | **按 ACP 标准接入**：`request_permission` 改用 `@agentclientprotocol/sdk@0.24.0` 官方类型（`RequestPermissionRequest`/`Response`、`PermissionOption[]`、`buildPermissionToolCall`→`ToolCallUpdate`、`RequestPermissionOutcome`），替换手写 inline 接口，编译期锁定协议 |
| 2026-06-27 | **B 弹窗式审批节点（范式2）**：`createPermissionApprovalNode`（节点内同步调 `onApprovalRequest`）+ `createAcpApprovalHandler`（总弹 unless yolo）；抽 `callAcpPermission` 与 A 共用 requestPermission/race/graceful；复用 A 通道而非 interrupt 桥接（不持久化、同节点不降级对话式）；测试 +9 例；[human-in-the-loop.md §2.3](./human-in-the-loop.md) 重写 |
| 2026-07-06 | **v1.9.0 subagent + ACP plan**：内置 `write_todos`；`task` 并行流式 `messageId=subagent:<name>:<toolCallId>`；`extractSubagentTaskOutput` 多级兜底；`AcpPlanCoordinator` 合并并行 subagent plan；子 agent 继承 MCP 搜索 + 委派后缀；`onPermissionRequest` 透传；详 [subagent-task-and-acp-plan.md](../subagent-task-and-acp-plan.md) |
| 2026-07-06 | **v1.9.1 加固**：`toolCallId` 回退用完整 UUID（非 threadId 后缀）；plan 发送队列在 `emitPlan` 前 `snapshot()`；`dev-agent` callbacks 对齐 `createStatefulFlow`（`onPlan` 等） |
| 2026-07-06 | **v1.9.2 systemPrompt 追加**：`resolveSystemPrompt` 保留 `prompts/flow.base.md`，ACP session 补充指令追加其后（对齐 `_meta.systemPrompt.append`）；详 [checkpoint-integrity-and-prompt-resolution.md](../checkpoint-integrity-and-prompt-resolution.md) |
| 2026-07-06 | **v1.9.3 think 清洗**：`sanitizeToolCalls` 于 think 调 LLM 前剥离孤立 `tool_calls`；兼容 checkpoint 反序列化 plain object |
| 2026-07-06 | **v1.9.4 checkpoint 写回**：`libs/messages`；cancel 时 `repairCheckpoint` 补 ToolMessage；`flow.run` 入口自动修复；详 [checkpoint-integrity-and-prompt-resolution.md](../checkpoint-integrity-and-prompt-resolution.md) |
