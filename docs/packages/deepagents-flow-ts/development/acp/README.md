# deepagents-flow-ts — ACP 协议对齐维护手册

> **受众**：Monorepo 维护者（改 `packages/deepagents-flow-ts` 的 surface / deepagents-acp 时必读）。  
> **不是**模板使用者文档；终端用户请看包内 [README.md](../../../../../packages/deepagents-flow-ts/README.md) 与 [zed-debug.md](../../../../../packages/deepagents-flow-ts/docs/zed-debug.md)。

本目录记录 **Agent Client Protocol (ACP)** 官方 schema 与本仓库实现的字段映射、双路径差异、NuwaClaw 宿主契约，以及与 [nuwax-ai/claude-code-acp-ts](https://github.com/nuwax-ai/claude-code-acp-ts) 的持续对齐进度。

---

## 快速入口

| 我要… | 文档 |
| --- | --- |
| 查官方 schema 版本、SDK 基线 | [spec-and-version.md](./spec-and-version.md) |
| 理解 Flow vs Legacy 双路径 | [architecture.md](./architecture.md) |
| 理清工具审批 vs 审批节点（HITL 总览） | [human-in-the-loop.md](./human-in-the-loop.md) |
| 接 ACP 工具审批（`request_permission` 实现细节） | [permission.md](./permission.md) |
| 查 `tool_call` / `tool_call_update` 字段怎么发 | [field-mapping.md](./field-mapping.md) |
| 查 MCP + LangGraph + ACP 全栈数据流 | [dataflow-nuwaclaw.md](./dataflow-nuwaclaw.md) §MCP 标准栈 |
| 改代码前核对清单、源码索引 | [maintenance.md](./maintenance.md) |
| **跟进追赶方案与阶段进度** | [roadmap-progress.md](./roadmap-progress.md) |
| 阶段 C 调研（流式 toolCallId） | [phase-c-streaming-research.md](./phase-c-streaming-research.md) |
| 阶段 E 调研（usage / 模式面，**暂缓**） | [phase-e-capabilities-research.md](./phase-e-capabilities-research.md) |
| 对照 claude-code-acp-ts 完整度 | [reference-implementation.md](./reference-implementation.md) |
| 看历史变更 | [changelog.md](./changelog.md) |

---

## 文档分层

```
development/acp/
├── README.md                    ← 本页（索引）
├── spec-and-version.md          ← §1 规范来源与版本
├── architecture.md              ← §2 双路径架构
├── field-mapping.md             ← §3 官方 schema ↔ Flow 字段
├── legacy-path.md               ← §4 deepagents-acp Legacy
├── dataflow-nuwaclaw.md         ← §5 端到端 + 宿主契约
├── maintenance.md               ← §6 核对清单 + §7 源码索引
├── roadmap-progress.md          ← §8 追赶路线图与进度（持续更新）
├── reference-implementation.md  ← §11 claude-code-acp-ts 对照
├── human-in-the-loop.md         ← HITL 总览：工具审批(A) vs 审批节点(B)
├── permission.md                ← A 工具审批实现（request_permission）
└── changelog.md                 ← 变更记录
```

---

## 当前状态（摘要）

| 维度 | 状态 |
| --- | --- |
| Flow 主路径 `rawInput` / `rawOutput` | ✅ |
| terminal `tool_call_update` 带 `title`/`kind` | ✅ |
| `locations` / `diff` / 工具展示层 | ✅ `acp-tool-presentation.ts` |
| 去掉 `input`/`output` + Legacy 统一 | ✅ 2026-06-27 |
| 权限 `requestPermission` rawInput | ✅ 2026-06-27 |
| 工具审批门控 A（`onPermissionRequest` / `permissions`） | ✅ 2026-06-27 见 [permission.md](./permission.md) |
| HITL 审批节点 B（对话式 interrupt + 弹窗式范式2 同步门控） | ✅ 2026-06-27 见 [human-in-the-loop.md](./human-in-the-loop.md) |
| 流式 `rawInput` 精炼 | ⏸️ 不需要；见 [phase-c-streaming-research.md](./phase-c-streaming-research.md) |
| 双轨去重（in_progress + terminal） | ✅ C-dedupe `emittedToolCallIds` / `completedToolCallIds` |
| per-session runtime + 会话配置解析 | ✅ `createExecutor` + `session-config.ts` / `session-diagnostics.ts` |
| `session/load` 消息回放（`getSessionHistory`） | ❌ Flow surface 未实现 |
| `usage_update` / 模式面 | ⏸️ 暂缓（非当前范围） |

详情见 [roadmap-progress.md](./roadmap-progress.md)。

---

## 相关文档（仓库外 / 兄弟包）

| 文档 | 位置 |
| --- | --- |
| **开发文档总索引** | [../README.md](../README.md) |
| ReAct 两阶段分工（think / tools） | [../react-two-phase.md](../react-two-phase.md) |
| MCP / Skill / Subagent 生命周期 | [../runtime-capabilities-lifecycle.md](../runtime-capabilities-lifecycle.md) |
| Zed 调试（使用者） | [packages/deepagents-flow-ts/docs/zed-debug.md](../../../../../packages/deepagents-flow-ts/docs/zed-debug.md) |
| LangGraph surface 收敛 | [../langgraph-native-convergence.md](../langgraph-native-convergence.md) |
| app-ts ACP 测试方案 | [../../deepagents-app-ts/development/acp-test-plan.md](../../deepagents-app-ts/development/acp-test-plan.md) |
| NuwaClaw MCP ask-question | `nuwaclaw/docs/mcp-ask-question-acp-toolcall-v1.md`（仓库外） |
| **ACP 官方 schema** | [github.com/.../schema](https://github.com/agentclientprotocol/agent-client-protocol/tree/main/schema) |
| **参考 Agent（首选）** | [nuwax-ai/claude-code-acp-ts](https://github.com/nuwax-ai/claude-code-acp-ts) |
| 上游 fork 来源 | [agentclientprotocol/claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) |

---

## 维护约定

1. **改 ACP 出站逻辑** → 同步更新 [field-mapping.md](./field-mapping.md) 与 [roadmap-progress.md](./roadmap-progress.md) 进度表。
2. **完成一个阶段** → 在 [changelog.md](./changelog.md) 记一条，勾选 roadmap 任务。
3. **新增 `sessionUpdate` 类型** → 更新 [field-mapping.md](./field-mapping.md) §类型一览 + [reference-implementation.md](./reference-implementation.md) 对照表。
