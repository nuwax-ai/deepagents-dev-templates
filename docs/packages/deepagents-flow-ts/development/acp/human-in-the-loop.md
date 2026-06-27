# 人在环中（HITL）审批总览

[← 返回索引](./README.md)

> flow-ts 里「人审」有**两套机制并存**，本文把它们统一讲清：各自触发什么、怎么工作、在 ACP 下怎么打通、由谁决定。
> 工具级审批（A）的完整细节见 [permission.md](./permission.md)；本文不重复，只做总览与关系梳理。

## TL;DR

| | **A 工具级审批** | **B 流程级审批节点** |
| --- | --- | --- |
| 谁触发 | LLM 决定调副作用工具（`write_file`/`bash`/`http_request`…） | 图跑到开发者主动放的 review/approve/confirm 节点 |
| 机制 | 同步门控 `onPermissionRequest` → ACP `session/request_permission` | LangGraph `interrupt()` → 跨轮 `Command(resume)` |
| 形态 | **turn 内、可多次、弹窗**（4 选项） | **跨 turn、一 turn 一次、对话式**（可演进为弹窗式，见 §3.2） |
| 决策者 | config `permissions.mode` / `interruptOn`（部署者） | 开发者在图里放不放审批节点、选哪种形态 |
| ACP 通信 | `session/request_permission`（**需客户端实现**） | **普通消息文本通道**（任何客户端天然支持）；弹窗式才需 `request_permission` |

一句话定位：**A 是工具执行前的秒级门控，B 是图流程中途的跨轮人审**。两者服务不同场景、UX 要求相反，刻意并存、不合并（见 §4）。

---

## 1. A 工具级审批（tool permission gating）

副作用工具执行前，节点层（`libs/nodes/tools.ts` `createToolExecNode`）对每个 `tool_call` 经 `onPermissionRequest` 回调同步征询客户端许可；`allow` 走 ToolNode 执行，`reject`/`cancelled` 合成 `Permission denied` error ToolMessage 喂回 LLM（A2 去重，turn 不中止）。ACP handler（`surfaces/acp/server.ts` `createAcpPermissionHandler`）按 `permissions.mode`/`interruptOn` 判定，命中名单的调 `conn.requestPermission` 弹窗。

完整机制、配置、出站语义、signal/cancel、源码索引：**详见 [permission.md](./permission.md)**。

## 2. B 流程级审批节点（interrupt）

### 2.1 机制

LangGraph 官方 `interrupt()` + `Command(resume)`：节点调用 `interrupt(payload)` 暂停图，等待一个 resume 值才能继续。flow-ts 已封装为通用审批节点 `libs/nodes/hitl.ts` `createHumanApprovalNode`：

```ts
// libs/nodes/hitl.ts
const feedback = String(interrupt(payload) ?? "").trim();   // payload = { question }
const approved = isApproval(feedback, ...);                  // 内置中英文通过词
```

已在用的拓扑：`libs/topologies/human-in-loop`（review 节点）、`libs/topologies/deep-research/nodes/delivery.ts`（交付前审批）。

interrupt 的 resume 值，在 ACP 下有**两种来源**——对应审批节点的两种形态。

### 2.2 对话式（现状已通）

resume 值 = **下一轮用户在输入框打的消息**。打通链路（每一步均有源码支撑，**不依赖客户端实现 `request_permission`**，走普通消息文本通道）：

```
① 图跑到审批节点 → interrupt({ question })
② surfaces/stateful-flow.ts consumeStream 抓 interrupt
     多模式经 mapStreamChunk 产 {type:"interrupt"} (:129-130)；兜底单模式经 pickInterruptValue (:103/144)
③ flow.run 返回 { status:"interrupted", question } (:202-203)
④ ACP onPrompt (surfaces/acp/server.ts:544-555):
     streamText(question) 把 question 当 agent_message_chunk 文本发出 → return end_turn
⑤ 下一轮用户输入文本 → hasStarted=true（checkpoint 已存在）→ mode="resume" (:522-524)
     → flow.run({ resume: text }) → new Command({ resume: text }) (stateful-flow.ts:188-191)
⑥ graph 从 interrupt 处恢复 → feedback = 用户输入 → isApproval 判定 → 继续/路由
```

要点：
- **任何 ACP 客户端都天然支持**——question 就是普通消息文本，用户在输入框打「通过 / ok / lgtm」即批准，打别的即驳回并附反馈。无需 `request_permission`。
- 跨进程/IDE 重启仍准：checkpoint 落盘（`FileCheckpointSaver`），`hasStarted` 据此判断续跑。
- 一 turn 一次 interrupt：审批问题发出后 turn 即结束，必须等用户下一条消息。

### 2.3 弹窗式（✅ 已实现 2026-06-27 · 范式2 同步门控）

动机：秒级 yes/no 审批（如「确认发布?」）用对话式太重——要结束 turn、逼用户发新消息。希望像工具审批那样 turn 内弹窗、用户点一下选项即可。

**实现采用范式2：复用工具审批（A）的同步门控通道，而非原计划的 interrupt 桥接。** A 落地后，弹窗式 UX / 机制与 A 完全相同（turn 内弹窗），无需重写 onPrompt 的 stream-resume 循环——节点内直接同步调审批回调即可。

```
节点 createPermissionApprovalNode (libs/nodes/hitl.ts)
  └ 同 turn 同步调 configurable.onApprovalRequest(e)    ← 不 interrupt、不结束 turn
        ▼
createAcpApprovalHandler (surfaces/acp/server.ts)
  └ mode=yolo / client 不支持 requestPermission → "allow"（不弹）
  └ 否则 title 经 buildPermissionToolCall 包成 toolCall
        → callAcpPermission（与 A 共用 requestPermission / raceWithAbort / graceful）
  └ 归一 allow/reject/cancelled → 节点据此走 approved / rejected 路由
        ▼
注入：baseConfig.configurable.onApprovalRequest（与 onPermissionRequest 同路径）
```

用法：

```ts
const confirm = createPermissionApprovalNode<S>({
  request: (s) => ({ title: "确认发布?", detail: s.draft }),
  approved: (s) => new Command({ goto: "publish" }),
  rejected: (s) => new Command({ goto: "revise" }),
});
```

**与原 interrupt 桥接设计的取舍**：范式2 改动小、复用 A 全部基础设施、与 A 心智统一；代价是不持久化（秒级审批可接受，同 A）、同一节点不能自动降级对话式（要对话式 / 详细反馈用 `createHumanApprovalNode`，§2.2）。

> **原 interrupt 桥接设计（未采用，存档备选）**：审批节点 interrupt 带弹窗元数据 → onPrompt 检测 → `await requestPermission` → 同 turn `Command(resume)` 续跑。保留 interrupt 持久化 + 可同节点降级对话式，但需改 flow-types/mapStreamChunk/consumeStream/onPrompt 核心流程。未来若需「持久化的弹窗审批」可回此路。

### 2.4 开发者怎么选

| 节点性质 | 推荐形态 |
| --- | --- |
| 秒级 yes/no（确认发布、确认删除） | 弹窗式 `createPermissionApprovalNode`（§2.3） |
| 需要详细反馈 / 多轮重审 / 长文 review | 对话式 `createHumanApprovalNode`（§2.2） |

## 3. 为什么两套不统一

UX 要求相反：
- **A** 要秒级、turn 内、不打断对话流 → 必须弹窗式同步门控。若改成 interrupt 式，一次回答里每个副作用工具都中断 turn、逼用户反复发消息，是灾难。
- **B** 要人想一想、给反馈、打断对话流是预期 → 跨轮对话式天然合适。

把 A 改 interrupt 式或把 B 改纯弹窗式，都会牺牲各自场景的体验，故刻意并存。

官方另两层 HITL（LangChain `humanInTheLoopMiddleware({interruptOn})`、deepagents `createDeepAgent({interruptOn})`）**不用**：前者挂不上手搓 `StateGraph`（`app/graph.ts`，非 createReactAgent），后者被 `onPrompt` 短路（注释自承 *"ACP does not drive humanInTheLoop interrupts"*）。详见 [permission.md §为何同步门控](./permission.md)。flow-ts 的 B 用的就是官方**第一层** `interrupt()`/`Command(resume)`——只是把它用于流程级审批节点，而非工具级。

## 4. 决策归属与通信边界（谁负责什么）

> 直接回答「审批策略归谁、模板保什么」。

| 维度 | 归属 |
| --- | --- |
| **审批策略** —— `permissions.mode`/`interruptOn`（A 审谁）、图里放不放审批节点、节点选对话式/弹窗式（B 审什么、怎么审） | **开发者 / 部署者**（config + 图编排） |
| **审批机制** —— 同步门控接入点、interrupt 封装、A2 合成、signal 中止（规则 / 记忆 / 审计交 client 中枢） | **模板（flow-ts）** |
| **通信链路** —— 服务端侧 `request_permission` 收发、4 选项解析、graceful 降级、interrupt→文本→resume 桥接 | **模板（flow-ts）** |
| **客户端实现 `session/request_permission`** | **ACP 宿主（NuwaClaw / IDE）** |

**通信边界（关键）**：模板只能保证**服务端侧收发正确**，保证不了客户端一定实现 `request_permission`：

- **A 工具审批**：客户端没实现 → `typeof conn.requestPermission !== "function"` → `return "allow"`（`server.ts:136`）**整条降级全放行**，审批形同虚设。
- **B 弹窗式**（范式2 同步门控）：客户端没实现 → `callAcpPermission` graceful `return "allow"`（同 A）。要对话式得改用 `createHumanApprovalNode`（同节点不自动降级）。

✅ **NuwaClaw 已确认实现 `session/request_permission`**——`agent-electron-client` 的 `permissionCoordinator` 决策链（question → strict write guard → tool_approval_rules → agent_mode → 人工 UI）+ `buildAcpPermissionInterventionRequest` / `approvalInterventionService`。**NuwaClaw 即审批决策中枢**：flow-ts 发标准请求 + 正确 `kind` options，NuwaClaw 裁决（规则 / strict 校验 / 审计 / 用户交互）；flow-ts 的 `interruptOn` 粗筛"哪些工具发请求"，与 NuwaClaw 细判**互补**。对接其他不支持 `request_permission` 的 client 时用 `DEEPAGENTS_PERMISSIONS_MODE=yolo` 兜底（B 对话式不受影响）。

## 5. 现状与已知问题

| 项 | 状态 | 位置 / 说明 |
| --- | --- | --- |
| A 工具审批 | ✅ 已实现 + 17 例测试 | 见 [permission.md](./permission.md) |
| B 对话式审批节点 | ✅ 已通（走消息文本通道） | `libs/nodes/hitl.ts`、`stateful-flow.ts:103/129-130/188-191/202-203` |
| B 弹窗式审批节点 | ✅ 已实现 2026-06-27（范式2） | `createPermissionApprovalNode` + `createAcpApprovalHandler`；同步门控复用 A 通道；测试 +9 例 |
| **A 时序缺陷** | ✅ 已修 2026-06-27 | 采用**修法2**：reject 补发 failed terminal（`in_progress`→`failed`，客户端不再卡转圈）；cancelled 仍跳过 terminal、交 `failInflightToolsOnCancel` 收尾（节点层 `deniedIds` / `cancelledIds` 区分）。`tests/acp-permission-gating.test.ts` 加 2 例。 |
| 客户端 `request_permission` | ✅ NuwaClaw 已确认 | `permissionCoordinator` 决策中枢（agent 发请求、NuwaClaw 裁决）；见 §4 |

## 6. 源码索引

| 项 | 路径 |
| --- | --- |
| A 契约 / 门控 / handler | `core/flow-types.ts`、`libs/nodes/tools.ts`、`surfaces/acp/server.ts:126-181`（详见 [permission.md](./permission.md)） |
| B 审批节点封装 | `libs/nodes/hitl.ts`：`createHumanApprovalNode`（对话式）/ `createPermissionApprovalNode`（弹窗式范式2）/ `isApproval` |
| B 弹窗 handler（范式2） | `surfaces/acp/server.ts` `createAcpApprovalHandler` / `callAcpPermission`（与 A 共用） |
| B interrupt 检测 + resume | `surfaces/stateful-flow.ts` `pickInterruptValue`/`consumeStream`/`run` |
| B onPrompt 桥接 | `surfaces/acp/server.ts` onPrompt interrupted 分支 |
| B 拓扑实例 | `libs/topologies/human-in-loop`、`libs/topologies/deep-research/nodes/delivery.ts` |
| 弹窗载荷复用 | `libs/deepagents-acp/acp-tool-presentation.ts` `buildPermissionToolCall` |
