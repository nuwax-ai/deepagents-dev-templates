# 术语对照表（Glossary）

> **用途**：固化本仓文档/注释里的关键术语，**指代准确**、跨文档一致，防止口语词随手写引入歧义。
>
> **原则**：指代准确即可——**优先英文术语**，或**已确认的中文译名**；只有**不准确/歧义的口语词**才必须替换。中英混排时，中文与英文之间留一个空格。

## 1. 编排 / 流程概念 —— 用英文术语

这些概念在 LangGraph / 本模板里有确切英文名，文档统一用英文，避免口语化中文产生歧义。

| 不准确口语（弃用） | 准确术语 | 说明 |
|---|---|---|
| 长任务、长任务硬化 | **durable stateful flow** | 多阶段 + 多轮 HITL + 跨重启续跑的有状态流程（`createStatefulFlow` 基座）。**“长任务”歧义**：既可能指持久化（durable），也可能指耗时（long-running），故弃用。 |
| （强调耗时/token 的）长任务 | **long-running**（pipeline / work） | 仅强调“运行耗时长”时用；不含“跨重启持久化”语义。 |
| 跨重启续跑 | **cross-restart resume** | 进程/IDE 重启后由 checkpointer 落盘续跑。 |
| 阶段进度 | **stage progress** | `emitStage` → `onStage`，多阶段流水线每步可见。 |
| 单步护栏、递归护栏 | **recursion guard** | 特指 `recursionLimit` 防 reflection 回边死循环。**仅 recursion 语境**用此词（见 §4）。 |
| 一个会话一个主题 | **one session, one topic** | `hasStarted` 从 checkpointer 推断续跑 vs 新开。 |
| 多模式 stream | **multi-mode stream** | `streamMode: ["messages","tools","custom","updates"]` + `mapStreamChunk`。 |
| 上下文压缩 | **context compaction** | `compactHistory` + `RemoveMessage` 替换历史。 |
| 多轮 HITL | **multi-turn HITL** | 多轮人审循环。 |
| 完成闸门 | **completion gate**（完成闸门） | 强制验证门；首次出现中英并列。 |
| ReAct、工具回路 | **ReAct** | 指“先推理再调用工具并回写上下文”的交替范式。默认图采用两阶段实现：`think` 负责决策（`bindTools`），`tools` 负责执行（`ToolNode`），再回到 `think` 直到可 `respond`。 |

## 2. 架构 / 接入层 —— 中文译名 + 英文括注

模板特定的接缝概念，用确认中文译名，**首次出现**带英文括注。

| 英文 | 确认中文（首次带括注） | 说明 |
|---|---|---|
| seam | **接入层（seam）** | surface 与具体图解耦的接缝。 |
| surface seam | **surface seam（接入层）** | 同上，强调在 surface 侧。 |
| plumbing | **接入逻辑**（plumbing） | surface 侧 ACP/CLI 复用的连接代码；统一用“接入逻辑”，勿用“运行时胶水代码 / plumbing”混写。 |
| app/flows | **可运行 flow 挂载点** | 唯一 app 层注册入口（内置 + scaffold）；积木图逻辑在 `libs/topologies`。 |

## 3. 打包 / 平台

| 不准确（弃用） | 确认用法 | 说明 |
|---|---|---|
| 平台面、产品口语中的厂商平台侧称呼 | **平台侧** | **技术服务用语**：指 **主平台** 一侧的元数据/接口（部署、在线配置、`mcpServers` 下发、能力登记等）。文档/注释统一称「平台侧」，即主平台一侧，勿用厂商产品名指代该侧。 |
| 产品口语问答卡片、dockpanel、结构化审阅卡片 | **平台问答卡片** | **技术服务用语**：指 **主平台** 在 ACP 宿主侧基于 ask-question MCP（`nuwax_ask_question`）与 `rawInput.ui` 渲染的**问答卡片**（结构化提问 UI）。用于图内 HITL 的固定字段表单展示；它是展示层，不替代 `interrupt` 的跨轮 checkpoint/resume。文档/注释统一称「平台问答卡片」，即主平台的问答卡片，勿用厂商产品名指代该 UI。 |
| 制品 | **压缩包** | 本仓打包产出（npm `.tgz` + nuwax `.tar.gz`/`.zip`）形式上**均为压缩文件**，故 `.md` 统一用“压缩包”。<br>**Nuance**：泛指构建产出物的抽象语义其实是 *artifact（制品）*；若某处强调“产出物”而非“压缩文件形态”，可保留“制品（artifact）”。 |
| 模版 | **模板** | 错别字订正。 |

## 4. 准确的确认中文 —— 予以保留（勿机械英文化）

下列中文**本就是对应英文的标准、准确译名**，不属于“不准确口语”。文档可中可英，**代码注释保留中文以利可读**，无需强行改成英文。

| 确认中文 | 等价英文 | 说明 |
|---|---|---|
| **拓扑** | topology | topology 的标准中文译名。`.md` 面向英文平台生态统一用 `topology`；`.ts` 代码注释保留“拓扑”。两者等价、皆准确。 |
| **流水线** | pipeline | 多阶段编排。 |
| **护栏** | guard | guard 的通用中文。**按语境细分**：<br>· recursion 语境 → **recursion guard**（见 §1）<br>· 超时语境 → **timeout guard**（`withTimeout`）<br>· 外部输入校验 → **input-validation guard**<br>**不可**把 timeout/validation 语境的“护栏”误植为 recursion guard。 |

## 5. 标点（中文行内）

中文句子里的标点统一用**全角**：`：`（冒号）、`（）`（括号）、`、`（顿号）。代码 / 路径 / 英文短语内部保持半角。

---

> **单一权威**：本表是模板内术语权威源；扩展 flow 或写系统提示词时以本表与 `docs/node-kit.md` 为准。
