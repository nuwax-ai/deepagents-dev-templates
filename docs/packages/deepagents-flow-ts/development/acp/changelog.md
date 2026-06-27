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
