# 工具权限审批（Flow 路径）

[← 返回索引](./README.md)

> Flow 生产路径（`onPrompt` 短路 deepagents agent、跑自研 LangGraph 图）的 ACP 工具审批。
> 副作用工具执行前经 ACP `session/request_permission` 征询客户端许可。
>
> 本文是 [human-in-the-loop.md](./human-in-the-loop.md) 里 **A 工具级审批** 的实现细节。
> A vs B（流程级审批节点）、两通道、职责划分、为何不用官方 `humanInTheLoopMiddleware` 等
> 全景与论证见 HITL 总览，本文不重复。

## 为何同步门控（一句话）

工具审批要 **turn 内、可多次、弹窗**；官方 interrupt 是 **中断 turn + 跨轮 resume**（对话式），
且 `humanInTheLoopMiddleware` 挂不上手搓 `StateGraph`。参考实现 claude-code-acp 同样用同步门控
（`canUseTool` → `requestPermission`）。完整论证见 [human-in-the-loop.md §3](./human-in-the-loop.md)。

## 数据流

```
createToolExecNode (libs/nodes/tools.ts)
  └ 对每个 tool_call → configurable.onPermissionRequest(e)        [A2 门控]
        │ allow            → 走 ToolNode 执行
        │ reject/cancelled → 合成 status:"error" 的 "Permission denied" ToolMessage
        │                    注入 ToolNode 输入；ToolNode 跳过该 tool_call_id（去重→不执行）
        ▼
onPermissionRequest 实现 = createAcpPermissionHandler (surfaces/acp/server.ts)
  └ 经 baseConfig.configurable 注入（stateful-flow.ts，与 onToolCall 同路径）
        │ mode=yolo / client 不支持 / 非 interruptOn → "allow"（不弹）
        │ 否则 conn.requestPermission({ toolCall, options:4 选项 }) 弹窗（每次，不缓存）
        ▼
ACP client（Zed / NuwaClaw）
```

节点层对**每个** tool_call 都触发回调，是否需要审批（名单 / 模式）全在 handler 内判定——对齐 Claude SDK `canUseTool`（单点判定）。

## 配置（复用 `permissions`）

`AppConfig.permissions`（`runtime/config/config-schema.ts`）：

| 字段 | 默认 | 作用 |
| --- | --- | --- |
| `mode` | `"ask"` | `yolo`=全放行 / `ask`=审批 interruptOn / `plan`=本期等同 ask |
| `interruptOn` | `["write_file","edit_file","bash","http_request"]` | 审批名单（不在=放行） |

- **bypass**：`mode:"yolo"`；env `DEEPAGENTS_PERMISSIONS_MODE=yolo`（既有管线，无新增开关）。
- **MCP 工具**（`mcp__*`）默认不在 interruptOn → 放行（已知边界；未来可加 `mcp__` 前缀启发式）。
- 副作用名单是**安全分类**，独立于 `adapter.ts getToolCallKind` 的 **UI 展示分类**（bash 注册名 `"bash"` 不在 kind 的 `execute` 名单，故不能靠 kind 判审批）。

## 出站语义

| 场景 | 执行 | 喂 LLM |
| --- | --- | --- |
| allow_once / allow_always | ✅ | 真实结果（always 记忆交 client 中枢） |
| reject_once/always | ❌ | 合成 `Permission denied` ToolMessage |
| cancelled（含 signal abort） | ❌ | 合成 error ToolMessage |

- **agent 不缓存**：`allow_always` / `reject_always` 的"记忆"交 client 审批中枢（NuwaClaw `permissionCoordinator` 的 RuleStore + strict guard 每次校验）；agent 每次对 interruptOn 工具发 `requestPermission`，对齐 claude-code-acp，避免 agent 缓存绕过中枢的规则 / 校验 / 审计。
- **拒绝不中止 turn**：合成 error ToolMessage 喂回 LLM，LLM 继续（可改方案 / 换工具）。
- **graceful 降级**：client 不实现 `requestPermission`（method-not-found）或 RPC 抛错 → 放行。✅ **NuwaClaw 已确认实现**（`permissionCoordinator`，见 [human-in-the-loop.md §4](./human-in-the-loop.md)）；对接其他不支持的 client 时用 `mode:"yolo"` 兜底。

## signal / cancel

审批 `await` 经 `raceWithAbort` 监听 `ctx.signal`；aborted → `"cancelled"`。整图被 `graph.stream({signal})` 中止抛 AbortError → `onPrompt` catch + `failInflightToolsOnCancel` 统一推 failed。审批层不重复发 `tool_call_update`。

## ACP 协议类型对齐

`request_permission` 全程用 `@agentclientprotocol/sdk@0.24.0` 官方类型（编译期锁定协议，SDK 升级字段变化 `tsc` 即报）：

| 处 | 官方类型 |
| --- | --- |
| `AcpToolConnection.requestPermission` | `RequestPermissionRequest` → `RequestPermissionResponse` |
| `PERMISSION_OPTIONS` | `PermissionOption[]`（kind=`PermissionOptionKind`：allow_once/allow_always/reject_once/reject_always） |
| `buildPermissionToolCall` | 返回 `ToolCallUpdate`（自定义 `AcpToolCallContent` 是官方 `ToolCallContent` 的精确子集，零断言） |
| outcome 解析 | `RequestPermissionOutcome`（`selected`+optionId / `cancelled`） |

## 源码 / 测试

| 项 | 路径 |
| --- | --- |
| 契约 | `core/flow-types.ts`（`onPermissionRequest` / `PermissionDecision` / `PermissionRequestEvent`） |
| 节点门控（A2） | `libs/nodes/tools.ts` `createToolExecNode` |
| ACP handler | `surfaces/acp/server.ts` `createAcpPermissionHandler`（+ `PERMISSION_OPTIONS` / `raceWithAbort`） |
| 注入 | `surfaces/stateful-flow.ts` baseConfig（与 onToolCall 同路径） |
| 展示载荷复用 | `libs/deepagents-acp/acp-tool-presentation.ts` `buildPermissionToolCall` |
| 测试 | `tests/acp-permission-gating.test.ts`（节点 A2 + surface handler 共 15 例） |

## 手动验证

ACP client 触发 `bash` / `write_file` → 见 `request_permission` 弹窗 → allow 执行 / reject 收 denied 后 LLM 继续；`DEEPAGENTS_PERMISSIONS_MODE=yolo` 重启 → 不弹直接执行；`session/cancel` 在审批 await 期间 → turn 中止 + inflight 推 failed。
