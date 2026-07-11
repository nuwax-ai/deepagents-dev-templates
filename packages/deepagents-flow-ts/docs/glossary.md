# Glossary

> 术语权威源。写文档/注释只查「用」列。实现细节 → `node-kit.md`；systemPrompt 解析 → `src/runtime/context/prompt.ts`。

## 编排 / 流程

| 弃用 | 用 | 定义 |
|---|---|---|
| 长任务、长任务硬化（持久化义） | **durable stateful flow** | `createStatefulFlow` 基座；多阶段 + multi-turn HITL + cross-restart resume |
| 长任务（耗时/token 义） | **long-running** | 仅运行耗时长；无跨重启持久化语义 |
| 跨重启续跑 | **cross-restart resume** | checkpointer 落盘；进程/IDE 重启后续跑 |
| 阶段进度 | **stage progress** | `emitStage` → `onStage` |
| 单步护栏、递归护栏（非 recursion 语境） | **recursion guard** | 仅指 `recursionLimit` 防 reflection 回边死循环 |
| 一个会话一个主题 | **one session, one topic** | `hasStarted` 推断续跑 vs 新开 |
| 多模式 stream | **multi-mode stream** | `streamMode: ["messages","tools","custom","updates"]` + `mapStreamChunk` |
| 上下文压缩 | **context compaction** | `compactHistory` + `RemoveMessage` |
| 多轮 HITL | **multi-turn HITL** | 多轮人审循环 |
| 完成闸门 | **completion gate**（完成闸门） | 强制验证门；首次中英并列 |
| 工具回路 | **ReAct** | `think`(bindTools) ↔ `tools`(ToolNode) → `respond` |

## Flow 交互形态

面向用户仅两类形态（「用」列中文）：**聊天助手型** / **固定流程型**。`chat` / `pipeline` 为对应机器值；`approval` 是固定流程型内**人审编排**的机器值（不作独立形态问用户）。

| 弃用 | 用 | 定义 |
|---|---|---|
| 无须写图的聊天模式名 | **聊天助手型** / **default flow** | `flow.active: "default"` + systemPrompt + 平台能力；**唯一默认路径**；开放追问勿手写图 |
| 管线、pipeline（对用户） | **固定流程型** | 机器值 `pipeline`；**仅用户明确要求**固定阶段一次交付时才考虑；直接改 `src/app/graph.ts`；流程内某步需人审/审批用 HITL interrupt+resume 编排（机器值 `approval`） |
| ~~人工确认型~~（已并入固定流程型） | **HITL / 人审编排** | 非独立用户形态；`createHumanApprovalNode` + interrupt/resume，作为固定流程型图里的一种节点编排 |
| flow 类型、图类型 | **flow profile** | `flows --json`；含 `interaction` / `implementation` / `userLabel` |
| 为了写图而写图 | **graphReason** | 用户明确要求手写图时须说明 default 为何不够 |

| 用户中文 | 机器值 | 默认落点 |
|---|---|---|
| 聊天助手型 | `chat` | **`default`（唯一默认）**；追问/客服/问答/搜索总结等一律先走此路径，不写图 |
| 固定流程型 | `pipeline`（人审步骤 `approval`） | **仅用户明确要求**（固定步骤、一次交付、翻译/审稿/打分/报告等）→ 直接改 `src/app/graph.ts` 手写图；流程内需审批/人工复核/定稿则加 HITL interrupt+resume 节点 |

| 弃用 | 用 | 定义 |
|---|---|---|
| - | **`flow.active`** | config 正式 flow 字段；缺省 `default` |

## 架构 / 接入层

| 弃用 | 用 | 定义 |
|---|---|---|
| 运行时胶水代码 | **接入逻辑**（plumbing） | surface 侧 ACP/CLI 复用连接代码 |
| - | **接入层**（seam） | surface 与图解耦接缝 |
| - | **surface seam** | surface 侧 seam |
| - | **可运行 flow 挂载点**（app/flows） | app 层注册入口；**仅 default**；图逻辑在 `graph.ts` |

## 平台侧

| 弃用 | 用 | 定义 |
|---|---|---|
| 平台面、厂商产品名指主平台 | **平台侧** | 主平台元数据/接口：部署、在线配置、`mcpServers`、能力登记 |
| dockpanel、结构化审阅卡片 | **平台问答卡片** | 主平台 ACP 侧 `nuwax_ask_question` + `rawInput.ui` 问答 UI；展示层，不替代 interrupt/resume |
| 模版 | **模板** | 错别字订正 |

## 保留中文（勿机械英文化）

| 弃用 | 用 | 定义 |
|---|---|---|
| topology（对用户分类） | **拓扑** | 内部图实现；用户分类见 §Flow 交互形态；本包无内置拓扑库 |
| guard（统称，无语境） | **护栏** | recursion → recursion guard；超时 → timeout guard（`withTimeout`）；校验 → input-validation guard |
| - | **流水线** | pipeline；多阶段编排 |

## systemPrompt

| 弃用 | 用 | 定义 |
|---|---|---|
| persona、人设、统一人格 | **场景系统提示词** | `agent.systemPrompt` / ACP 下发；角色/风格/输出约束 |
| - | **runtime.systemPrompt** | `resolveSystemPrompt`：本地 `prompts/flow.base.md` + ACP 追加 + `PLATFORM_CONVENTIONS` |
| - | **领域 prompt** | 图内各 LLM 节点 SystemMessage；与旧 scaffold spec 无关 |
| 「systemPrompt 注入图」（无来源/节点） | 写明 **runtime/config** + **目标节点** | 例：`runtime.systemPrompt → think` |

| 图 | 注入点 | runtime | 备注 |
|---|---|---|---|
| default | prepare / think（优先） | config / ACP 兜底 | 单 ReAct conversational |

## 格式

中文行内标点全角：`：` `（）` `、`；代码/路径/英文短语半角。
