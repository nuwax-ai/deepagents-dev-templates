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

面向用户用「用」列中文；`chat` / `pipeline` / `approval` 为机器值，不直接问用户。

| 弃用 | 用 | 定义 |
|---|---|---|
| 无须写图的聊天模式名 | **聊天助手型** / **default flow** | `flow.active: "default"` + systemPrompt + 平台能力；开放追问勿 custom graph |
| 管线、pipeline（对用户） | **固定流程型** | 机器值 `pipeline`；翻译/审稿/打分/报告 |
| HITL/interrupt（对用户） | **人工确认型** | 机器值 `approval`；interrupt/resume 或 human-in-loop preset |
| flow 类型、图类型 | **flow profile** | `flows --json`；含 `interaction` / `implementation` / `userLabel` |
| 为了写图而写图 | **graphReason** | `custom` spec 必填；说明 default/preset 为何不够 |

| 用户中文 | 机器值 | 默认落点 |
|---|---|---|
| 聊天助手型 | `chat` | `default`；必要时 chat preset |
| 固定流程型 | `pipeline` | preset；否则 `custom` + graphReason |
| 人工确认型 | `approval` | HITL preset；否则 `custom` + graphReason |

| 弃用 | 用 | 定义 |
|---|---|---|
| - | **`flow.active`** | config 正式 flow 字段；缺省 `default` |

## 架构 / 接入层

| 弃用 | 用 | 定义 |
|---|---|---|
| 运行时胶水代码 | **接入逻辑**（plumbing） | surface 侧 ACP/CLI 复用连接代码 |
| - | **接入层**（seam） | surface 与图解耦接缝 |
| - | **surface seam** | surface 侧 seam |
| - | **可运行 flow 挂载点**（app/flows） | app 层注册入口；图逻辑在 `libs/topologies` |

## 平台侧

| 弃用 | 用 | 定义 |
|---|---|---|
| 平台面、厂商产品名指主平台 | **平台侧** | 主平台元数据/接口：部署、在线配置、`mcpServers`、能力登记 |
| dockpanel、结构化审阅卡片 | **平台问答卡片** | 主平台 ACP 侧 `nuwax_ask_question` + `rawInput.ui` 问答 UI；展示层，不替代 interrupt/resume |
| 模版 | **模板** | 错别字订正 |

## 保留中文（勿机械英文化）

| 弃用 | 用 | 定义 |
|---|---|---|
| topology（对用户分类） | **拓扑** | 内部图实现/scaffold；用户分类见 §Flow 交互形态 |
| guard（统称，无语境） | **护栏** | recursion → recursion guard；超时 → timeout guard（`withTimeout`）；校验 → input-validation guard |
| - | **流水线** | pipeline；多阶段编排 |

## systemPrompt

| 弃用 | 用 | 定义 |
|---|---|---|
| persona、人设、统一人格 | **spec.systemPrompt** / **场景系统提示词** | scaffold 槽位；角色/风格/输出约束 |
| - | **runtime.systemPrompt** | `resolveSystemPrompt`：ACP 追加 → config inline → `systemPromptPath` → fallback |
| - | **领域 prompt** | 拓扑内各 LLM 节点 SystemMessage；与 spec 无关 |
| - | **角色开场** | spec 注入单节点时仅换角色开场；JSON 契约等领域默认保留 |
| 「systemPrompt 注入图」（无来源/节点） | 写明 **spec/runtime** + **目标节点** | 例：`spec → compose` |

| 拓扑 | spec → | runtime | 备注 |
|---|---|---|---|
| default / react-tools | prepare/think（优先） | spec 空时兜底 | 单 ReAct |
| dev-agent | 不注入 | 唯一通道 | 同 default 图 |
| human-in-loop | compose | 不混入 | spec 空 → `DEFAULT_COMPOSE_PROMPT` |
| project-manager | plan 角色开场 | 不用 | 其余节点领域默认 |
| travel-planner | aggregate 角色开场 | 不用 | 其余节点领域默认 |
| rag / adaptive-rag | 不注入 | 不用 | 各节点领域 RAG prompt |
| deep-research | 不注入 | 不用 | clarify/plan/research/draft/converse 等领域 prompt |

## 格式

中文行内标点全角：`：` `（）` `、`；代码/路径/英文短语半角。
