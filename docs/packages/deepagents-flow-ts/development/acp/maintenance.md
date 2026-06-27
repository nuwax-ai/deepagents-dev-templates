# 维护核对清单与源码索引

[← 返回索引](./README.md)

---

## 改 tool 相关代码后

- [ ] `tool_call` 是否包含 **`rawInput`**（不只 `input`）
- [ ] `tool_call_update` completed 是否 **`rawInput` 回填** + **`rawOutput`** / `content`
- [ ] `content` 是否为 `ToolCallContent` 嵌套（`type:"content"` + 内层 `ContentBlock`）
- [ ] MCP 结果是否经 `normalizeToolResult`（无双重 JSON 字符串）
- [ ] 跑 `pnpm test` 中 `tests/acp-emit-tool-call.test.ts`、`tests/acp-cancel-and-resume.test.ts`
- [ ] 更新 [field-mapping.md](./field-mapping.md) 与 [roadmap-progress.md](./roadmap-progress.md)（若行为变更）

---

## 升级 `@agentclientprotocol/sdk` 后

- [ ] 对比新版 schema 中 `ToolCall` / `ToolCallUpdate` 字段增减
- [ ] 检查 `DeepAgentsServer` / `AgentSideConnection` 类型是否变更
- [ ] 评估是否去掉 `deepagents-acp` 的 `@ts-nocheck` 或合并 emit 逻辑
- [ ] 在 NuwaClaw 或 Zed 上手工触发一次 `nuwax_ask_question`

---

## 新增 `sessionUpdate` 类型时

- [ ] 在 [field-mapping.md](./field-mapping.md) 类型表登记
- [ ] 在 [reference-implementation.md](./reference-implementation.md) 对照表更新
- [ ] 补充 vitest（参考 `map-stream-chunk.test.ts`）
- [ ] 确认分层：出站逻辑放 `surfaces/acp`，不放 `app/`

---

## 源码索引

| 职责 | 路径 |
| --- | --- |
| ACP server 入口、hooks、流式文本/plan | `packages/deepagents-flow-ts/src/surfaces/acp/server.ts` |
| 工具展示层（Flow + Legacy 共用） | `packages/deepagents-flow-ts/src/libs/deepagents-acp/acp-tool-presentation.ts` |
| ToolCall → session/update（Flow 出站） | `packages/deepagents-flow-ts/src/surfaces/acp/emit-tool-call.ts` |
| Session cwd / mcpServers / model 解析 | `packages/deepagents-flow-ts/src/surfaces/acp/session-config.ts` |
| LangGraph stream → 内部事件 | `packages/deepagents-flow-ts/src/surfaces/map-stream-chunk.ts` |
| 内部事件 → FlowCallbacks | `packages/deepagents-flow-ts/src/surfaces/dispatch-surface-event.ts` |
| 有状态 run-loop + streamMode | `packages/deepagents-flow-ts/src/surfaces/stateful-flow.ts` |
| 工具结果归一化 | `packages/deepagents-flow-ts/src/libs/nodes/tool-result-normalize.ts` |
| ToolNode + onToolCall 三态 | `packages/deepagents-flow-ts/src/libs/nodes/tools.ts` |
| Legacy DeepAgents ACP | `packages/deepagents-flow-ts/src/libs/deepagents-acp/server.ts` |
| title / kind / locations 格式化 | `packages/deepagents-flow-ts/src/libs/deepagents-acp/adapter.ts` |

### 测试

| 文件 | 覆盖 |
| --- | --- |
| `tests/acp-emit-tool-call.test.ts` | rawInput、rawOutput、structuredContent |
| `tests/acp-tool-presentation.test.ts` | locations、diff、rawOutput、permission |
| `tests/acp-cancel-and-resume.test.ts` | cancel 时 tool_call_update |
| `tests/map-stream-chunk.test.ts` | on_tool_end 解析 |
| `tests/node-kit.test.ts` | createToolExecNode + configurable.onToolCall |
| `tests/default-flow-acp-mcp.test.ts` | MCP 合并进 runtime |
