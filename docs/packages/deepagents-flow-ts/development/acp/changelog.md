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
