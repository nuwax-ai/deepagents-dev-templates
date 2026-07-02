# ask-question MCP 与 HITL 选型

[← 返回开发文档索引](./README.md)

> **状态**：✅ 现行（2026-07-02）  
> **关联源码**：[`config/mcp.default.json`](../../../../packages/deepagents-flow-ts/config/mcp.default.json)、[`src/libs/nodes/hitl.ts`](../../../../packages/deepagents-flow-ts/src/libs/nodes/hitl.ts)、[`src/libs/topologies/human-in-loop/graph.ts`](../../../../packages/deepagents-flow-ts/src/libs/topologies/human-in-loop/graph.ts)、[`src/surfaces/acp/emit-tool-call.ts`](../../../../packages/deepagents-flow-ts/src/surfaces/acp/emit-tool-call.ts)

本文记录 **内置 ask-question MCP**、与 **HITL 三种形态** 的分工，以及 code-review 后的约定与已知边界。

---

## TL;DR

| 需求 | 用什么 |
| --- | --- |
| 结构化审阅表单（通过/修改 + 意见） | `present_review`（ask-question MCP）+ `createHumanApprovalNode`（interrupt） |
| 纯文本「说意见或 ok」 | 仅 `createHumanApprovalNode` |
| 秒级二元确认 | `createPermissionApprovalNode` |
| default ReAct 普通对话 | **不要**让模型调 `nuwax_ask_question` |

---

## 1. 内置 ask-question（包级 fallback）

`config/mcp.default.json` 内置 server：

```json
{
  "servers": {
    "ask-question": {
      "command": "npx",
      "args": ["-y", "nuwax-ask-question-mcp@latest"]
    }
  }
}
```

| 层级 | 来源 | 优先级 |
| --- | --- | --- |
| 低 | `mcp.default.json` | fallback（本地/CLI 无平台下发时） |
| 高 | ACP `session/new` 的 `mcpServers` | **session-wins**（平台同名覆盖） |

实现：`createRuntimeContext` → `mergeAndSanitizeMcpServers(defaultServers, sessionServers)`，`mergeServers` **后者覆盖同名**。

> **注意**：`config.mcp.mergeStrategy`（`session-wins` / `defaults-wins`）目前在 schema 与文档中存在，但 **runtime 未读取该字段**——行为恒为 session 层在后、平台优先。若未来支持 `defaults-wins` 须改 `runtime-context.ts` 并补单测。

---

## 2. 图内 HITL：MCP 展示 + interrupt（推荐范式）

ask-question **不维护 LangGraph checkpoint**（工具返回 `pending`）。durable resume 仍靠 `interrupt`。

```
START → compose → present_review → review(interrupt) → finalize → END
              ↑ 平台问答卡片（可选）    ↑ 收用户回复（checkpoint）
```

| 节点 | 实现 | 职责 |
| --- | --- | --- |
| `present_review` | `createAskQuestionPresentationNode(findAskQuestionTool(allTools))` | direct `tool.invoke` + `onToolCall` 三态；失败则空更新，降级纯文本 |
| `review` | `createHumanApprovalNode` + `normalizeReviewFeedback` | `interrupt` 收回复；归一化 JSON /「处理方式：通过」→ `ok` 或意见 |
| `finalize` | `createApprovalFinalizeNode` | 通过短路 / LLM 修订 |

**为何必须两节点**：MCP 节点完成后写入 checkpoint；下一轮 `resume` 只重跑 `review`，避免重复弹表单。

范例：[`examples/human-in-loop/`](../../../../packages/deepagents-flow-ts/examples/human-in-loop/)、拓扑权威 [`libs/topologies/human-in-loop/`](../../../../packages/deepagents-flow-ts/src/libs/topologies/human-in-loop/)。

### 2.1 ACP 出站要求

**平台问答卡片**依赖：

- `rawInput.ui`（completed 须保留首包 `rawInput`，见 `emit-tool-call.ts`）
- 工具名含 `nuwax_ask_question`；title 用于 ACP 宿主合成 `ASK_QUESTION` 事件

### 2.2 与「对话式 / 弹窗式」对比

详见 [acp/human-in-the-loop.md](./acp/human-in-the-loop.md)。ask-question 是 **B 流程级审批** 在 **平台客户端** 上的 **UI 增强层**（平台问答卡片），不是 A 工具审批。

---

## 3. default ReAct 与 ask-question 的边界

内置后，`think` 会 bind `ask-question__nuwax_ask_question`。为避免模型滥用：

- **系统提示词**（`prompts/flow.base.md`）：标明仅用于结构化多字段提问，**不是**闲聊或联网搜索
- **图编排 HITL**：优先用 human-in-loop 拓扑的 `present_review` 节点，而非让 ReAct 在 think 里自发调 MCP
- **travel-planner / project-manager / deep-research**：仍用纯 `createHumanApprovalNode` 文本 interrupt（无强制 ask-question）

---

## 4. Code review 处理记录（2026-07-02）

| 项 | 处理 |
| --- | --- |
| hitl 缺 ask-question 选型说明 | ✅ 扩充 `libs/nodes/hitl.ts` 模块注释 + 本文 |
| dev-agent-flow 仍写「mcp.default 为空」 | ✅ `part3-tools-config.md` 补充 ask-question 例外 |
| default ReAct 可能误用 ask-question | ✅ `flow.base.md` 增加使用边界 |
| `mergeStrategy` 未接线 | 📋 本文 §1 标明现状；实现待办 |
| Flow 注册表删减（breaking） | 📋 见 §5 |
| HITL 集成测试未走 runtime MCP 路径 | ✅ `review.test.ts` 增加 mock `askQuestionTool` 图编译用例 |
| 离线环境 npx 启动失败 | 接受：per-server 隔离，不拖垮其他工具；日志见 hydrate |

---

## 5. Breaking：内置 flow 注册表精简

`src/app/flows/index.ts` 仅保留：

- `default`、`search-aggregator`（conversational + 平台能力样板）
- `translate-review`、`router-gate`（custom 教学）

已**从注册表移除**（文件可仍由 scaffold 生成，但 `activeFlow` 不再解析）：`interview-agent`、`knowledge-qa`、`trip-planner`、`grade-redo`、`multi-aspect-search` 等。

未知 `activeFlow` → **warn + 回落 default**（不 fail-fast）。迁移：改 `config.activeFlow` 或重新 `scaffold` 注册。

---

## 6. 验证

```bash
cd packages/deepagents-flow-ts
pnpm test tests/mcp-config-path.test.ts tests/default-flow-acp-mcp.test.ts
pnpm test examples/human-in-loop/tests/review.test.ts
pnpm test tests/session-tool-trace.test.ts   # SMOKE_EXPECT_TOOL 脱敏摘要
```

---

## 7. 源码索引

| 项 | 路径 |
| --- | --- |
| HITL 工厂与选型注释 | `src/libs/nodes/hitl.ts` |
| ask-question 展示节点 | `src/libs/topologies/human-in-loop/graph.ts` |
| 工具查找 | `findAskQuestionTool` |
| 表单回复归一化 | `normalizeReviewFeedback` |
| MCP 默认配置 | `config/mcp.default.json` |
| MCP 合并 | `src/runtime/context/runtime-context.ts` |
| ACP tool 出站 | `src/surfaces/acp/emit-tool-call.ts` |
