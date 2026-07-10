# Part 0：端到端开发流程

> 所属：`flow-builder` L2-A（总流程）。入口路由见 [SKILL.md](../SKILL.md)。
> 本技能承载会话启动、交互形态选型、脚手架、completion gate 等**逐步实现**流程；各 Part 分工见 [SKILL.md](../SKILL.md) 路由表。

## 会话启动（先于一切开发）

| 步 | 动作 | 细节 |
|----|------|------|
| 0 | 装依赖 | `package.json` 且无 `node_modules`/lock 变更 → `pnpm install`；`pyproject.toml` 且无 `.venv` → `uv sync --group dev` |
| 1 | 读上下文 | `README.md`、`project.md`（无则创建，记录项目记忆与关键决策） |
| 2 | 系统提示词基线 | `dev-engineer-toolkit` → `get-config.sh --key systemPrompt`（及 `openingChatMsg`）。若平台 **空/占位** 且用户已描述 Agent → **先于写图**走 [part5-prompt-design.md](part5-prompt-design.md) § 用户输入提炼 |
| 3 | 读当前项目文档 | `docs/glossary.md` → `flow-graph-rules.md` → `node-catalog.md` → `node-kit.md` → `config/flow-agent.config.json` |
| 4 | 简报 | 项目状态 + 待办，再处理用户指令 |

**平台配置**：读写平台在线配置（`systemPrompt` / `tools` / `skills` 等）一律经 `dev-engineer-toolkit`（禁止只改本地）。

---

## Phase 1：需求分析与交互形态选型

### 第 0 问：交互形态分类（对用户只说这三种）

| 判断 | 需求信号 | 落点 |
|------|----------|------|
| **聊天助手型** | 「支持追问」「继续问」「随便问」「助手」「客服」「问答」「搜索总结」——用户会连续发问或开放提问 | `flow.active: "default"` + 平台能力登记 + systemPrompt，**不写图**；确需专属样板才建薄 recipe（对照 `search-aggregator`） |
| **固定流程型** | 「先 A 再 B」「固定步骤」「翻译这段」「审这篇」「生成报告」「给 X 打分」——流程固定、一次交付 | preset 优先；不满足才 `custom`，且 spec 必须写 `interaction` + `graphReason` |
| **人工确认型** | 「审批」「确认后发布」「人工复核」「修改意见」「定稿」 | HITL 系（`human-in-loop` / `project-manager`）或 approval custom |

**聊天助手型默认路径（MVP 最快）**：`flow.active: "default"` + `dev-engineer-toolkit` 登记平台能力 + Part 5 systemPrompt 定制 ≈ 交付，**不写任何图代码**。新建图必须能说明「default 为什么不够」（如：固定阶段顺序、需 Send 并行、需 HITL interrupt），说不出就走聊天助手型。

> **反例（真实失败案例）**：「搜索聚合 Agent，支持**追问和钻取**」被误判成 fanout×4 固定流程——每轮盲搜 4 路、无法真正追问钻取。「追问」即聊天助手型信号，正确落点：default ReAct + 平台搜索能力登记 + systemPrompt。

**无法判断时的固定话术**：`我先按“可追问的聊天助手”来做，这样交付最快、也最适合开放式需求；如果你后续需要固定审批或多阶段处理，再升级成流程版。`

1. **先查 runtime profile**：`pnpm exec tsx src/index.ts flows --json`；推荐可用 `pnpm exec tsx src/index.ts flows recommend --kind chat|pipeline|approval`
2. **脚手架优先**（第 0 问判定为固定流程型/人工确认型后）→ [part1-scaffold.md](part1-scaffold.md)（preset + `custom`）
3. **系统提示词并行** → 用户 Agent 描述按 [part5](part5-prompt-design.md) § 用户输入提炼 **持续合并**；定稿后尽早同步平台，禁止收工仍空 `systemPrompt`
4. **命中 preset** → 写 spec → `node scripts/scaffold/generate.mjs <spec>` → 改 `flow.active` → 进 Phase 2 生成路径
5. **不命中** → 先用 `custom`，必须写 `interaction` + `graphReason`；仍不行 → [part2-orchestration.md](part2-orchestration.md) 手写

### 平台能力门禁（Phase 1 必做 · 写图前 · 通用）

凡 Agent 依赖**工作区以外**的能力，**必须先**完成 Part 3 § 平台能力登记，**再**写 spec / `graph.ts` / `flow-tools.ts` / 自写 `*.tool.ts`。

**触发（满足任一）**：

- 用户要调用外部 API、第三方数据、业务 Plugin、知识库、平台技能
- 用户要联网 / 搜索 / 实时资讯 / 多源调研（**较常见**；另见 Part 3 § 联网搜索）
- 计划使用：`createToolExecNode` · `bindTools` · `flow-tools.ts` 新增工具 · `rag`/`adaptive-rag` 检索 · ReAct 接业务工具
- 交互形态 / flow profile：`chat`、`pipeline`、`approval` 中任一计划使用平台工具，或 custom 含 `tool-exec`

**豁免（仍须 Part 3 知情，但可不 add-tool）**：纯 LLM 对话、无外部 I/O；仅内置 `bash`/`read_file`/`grep`（工作区内）。

| 步 | 动作 |
|----|------|
| 1 | 加载 `dev-engineer-toolkit` + [part3-tools-config.md](part3-tools-config.md) § 平台能力登记 |
| 2 | 按能力拆词：`search-apis.sh --kw "<关键词>"`（可多轮）；需技能 → `search-skills.sh` |
| 3 | 命中 → `add-tool.sh` |
| 4 | `get-config.sh --key tools --full` 拉取已注册工具真实配置（含 schema）固化进 `spec.tools`（**禁止**手抄）；固定管道在节点 `params` 写 `toolName` / `tools` → `project.md` 记 targetId / 工具名 |
| 5 | 平台确无命中 → 记录关键词与输出，**然后**方可走优先级 3 自写 app 工具 |
| 6 | **然后**写 spec / `graph.ts` |

> **禁止**：先写占位工具 / 空 `flow-tools.ts` 再 smoke 报完成，把平台登记甩给「用户待操作」；**为已登记能力手写 fetch/`tool()` 包装**。**联网搜索**是高频场景，同样不得跳过登记；当前项目不内置互联网搜索。

### Factory 速查（手写路径）

| 需求 | Factory |
|------|---------|
| 用户可见大段 LLM 文本 | **`createLlmStreamNode`**（`r.text`；spec `llm-stream`） |
| 中间 JSON / 结构化 | `createLlmNode`（`r.parsed` 时） |
| LLM 裁决路由 | `createLlmRouterNode` |
| tool_calls | `createToolExecNode` |
| HITL interrupt（纯文本） | `createHumanApprovalNode` |
| HITL **平台问答卡片**（interrupt 前展示表单） | `createAskQuestionPresentationNode`（`human-in-loop/graph.ts`）；表单回复用 `normalizeReviewFeedback` |
| HITL 后置定稿 | `createApprovalFinalizeNode` |
| 同 turn 工具审批弹窗 | `createPermissionApprovalNode` |
| input→HumanMessage | `createPrepareNode` |
| Send 并行 | `createFanout` |
| 子图 | `createSubgraphNode` |

### Topology 参考实现

`src/libs/topologies/`：`rag` · `adaptive-rag` · `travel-planner` · `project-manager` ·
`human-in-loop` · `deep-research`；`dev-agent` 在 `src/app/flows/dev-agent/`，
`react-tools` 复用默认图。

场景示范：`scripts/scaffold/specs/_example.*.flow.json` → scaffold 生成到 `src/app/flows/`；
不要把 scaffold 薄封装当成第二份图实现。

---

## Phase 2：开发实现

### 路径 A · 命中 preset 或 custom scaffold

1. **需平台能力** → 须已完成上文「平台能力门禁」
2. spec → `generate.mjs` → `flow.active` → part1 自验 → Phase 3

### 路径 B · Bespoke 手写

| 步 | 动作 |
|----|------|
| 1 | 读最接近的 `src/libs/topologies/` 参考实现或 scaffold spec |
| 2 | `src/app/`：`graph.ts` 连线、`nodes/`、`flow-tools.ts` |
| 3 | 节点优先 factory；bespoke 须说明原因 |
| 4 | `Annotation.Root`；Send 并行加 reducer |
| 5 | 节点返回 Partial；禁止 mutate state |
| 6 | 图规则 → 当前工作目录 `docs/flow-graph-rules.md`（**R-G001+**） |
| 7 | 用户可见输出 → **R-G009** `createLlmStreamNode` + `r.text`；手改 graph 同步 spec（**R-G003**） |
| 8 | 工具 → [part3-tools-config.md](part3-tools-config.md) → `src/app/` → `createFlowTools()` |
| 9 | 系统提示词 → [part5](part5-prompt-design.md)；填 scaffold `systemPrompt`（若对应模板注入） |
| 10 | 更新 `project.md` |

编排细节 → [part2-orchestration.md](part2-orchestration.md)

---

## Phase 3：验证（completion gate）

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm graph
# 然后用 flow-debugger 真实执行：debug.sh --message "..." [--expect-tool <工具名子串>]
```

- **迭代快检**：开发中用 flow-debugger `debug.sh --message "<短 prompt>"`，走平台真实链路
- **真实运行门**：收工前必须 flow-debugger 真实调试；本地 `pnpm smoke` / rcoder-cli 已移除
- **前置**：`config.flow.active` 指向当前 flow（旧 `activeFlow` 兼容但不新增），平台配置已同步
- **细则**： [part4a-verify-debug.md](part4a-verify-debug.md) + [part4b-smoke.md](part4b-smoke.md)
- **排查**： [part4a](part4a-verify-debug.md) § 读日志六步、典型错误

失败 → 修 → 重跑（至多 5 轮）→ 仍失败如实交回。

---

## Phase 4：报告

1. 完成了什么（交互形态 / 节点 / 关键图能力）
2. **用户待操作事项、风险与后续**（见下表；**无真待办则整段省略**）
3. `project.md` 已更新（含已登记 targetId、工具名；固定管道含节点工具名引用）
4. **平台 `systemPrompt` 非空且已回读**（`openingChatMsg` 若涉及）
5. 提示词提炼来源（用户哪些输入 → 哪一字段）
6. **需平台能力时**：`search-apis` / `search-skills` / `get-config` 结果摘要（或「已搜索、无命中」+ 关键词）；自写工具须说明平台无命中依据（**联网搜索较常见**，须单独列出搜索关键词）
7. **平台能力真实调用证据**：flow-debugger 调用轨迹片段（`debug.sh --expect-tool` 断言通过；工具被调用且 success）

### Phase 4「后续」可写 / 禁止（平台默认集成）

本架构下平台沙箱已默认注入开发运行时上下文（平台 API、沙箱认证、项目标识等）。**不得**在报告、对话、收工说明中复述具体环境变量名，也**不得**要求用户手动配置。

| 可写（真用户侧业务待办） | 禁止写入 Phase 4 / 对话 |
|--------------------------|-------------------------|
| 业务数据录入、审批、上线决策 | 任何沙箱/平台**环境变量名**（脱敏：只说「平台已集成」或不提） |
| 用户明确要求的模型/套餐选择（非开发 Agent 代劳） | `add-tool` / `search-apis` / `get-config` / Plugin **Authorization** / API key 登记 |
| 无待办 | 「后续」「用户需确保运行时…」等占位段；平台/沙箱集成说明 |

> **禁止**：把开发期未完成的平台能力登记写成「用户后续配置」；把 平台默认能力写成待办事项。

---

## completion gate 收尾清单

报「完成 / done」前逐条贴证据（详述见 [part4a](part4a-verify-debug.md)）：

- [ ] 四连命令退出 0（`build` / `typecheck` / `test` / `graph`）+ flow-debugger 真实调试通过
- [ ] 声称改动文件经 `read_file` / `ls` 实证
- [ ] `.logs/` 无未预期 `error`
- [ ] `get-config.sh --key systemPrompt` 回读**非空**；用户发过 Agent 描述 → 已按 part5 提炼并同步
- [ ] 用户可见 LLM 节点 → `createLlmStreamNode` + `r.text`（**R-G009**）
- [ ] **需平台能力**（见 Phase 1「平台能力门禁」）→ 已贴 `search-apis.sh` / `search-skills.sh` 与/或 `get-config.sh --key tools|skills` **原始输出**；有命中 → 已 `add-tool.sh`；固定管道需要时节点 `params` 已写 `toolName` / `tools`；无命中 → 报告写明关键词与「已搜索、无命中」后方可自写工具。**联网搜索较常见**，须含搜索关键词证据。**未搜平台即报完成 = 不通过**
- [ ] **平台能力真实调用**（凡已登记）→ `debug.sh --expect-tool <工具名子串>` + 触发式 prompt 通过，已贴工具调用轨迹片段。**未验证工具真调用 = 不通过**（LLM 兜底输出会假绿）

---

## LangGraph 文档（TS API）

- 参考：<https://docs.langchain.com/oss/javascript/langgraph/overview>
- 查 API 时 query 带 `javascript` / `typescript`；优先官方文档。

---

## 开发 Agent 内置工具（libs/tools + flow-tools）

| 工具 | 用途 |
|------|------|
| `bash` / `read_file` / `write_file` / `edit_file` | shell / 文件 |
| `grep` / `glob` | **仅工作区**检索（非联网） |
| `http_request` / `json_utils` | HTTP / JSON |
| `load_skill` / `task` | skill 加载 / 平台 subagent 委派 |
| `echo` / `calculate` / `time` | demo fallback |
