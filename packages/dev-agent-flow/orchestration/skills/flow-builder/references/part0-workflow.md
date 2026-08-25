# Part 0：端到端开发流程

> 所属：`flow-builder` L2-A（总流程）。入口路由见 [SKILL.md](../SKILL.md)。
> 本技能承载会话启动、形态确认（一律 default ReAct）、completion gate 等**逐步实现**流程；各 Part 分工见 [SKILL.md](../SKILL.md) 路由表。

## 会话启动（先于一切开发）

| 步 | 动作 | 细节 |
|----|------|------|
| 0 | 装依赖 | 缺少 `node_modules`，或 lock 有变更 → `pnpm install` |
| 1 | 读上下文 | `README.md`；`project.md` 存在则读、无则创建（只记录项目记忆、关键决策、已登记工具名、验证方式） |
| 2 | 系统提示词基线 | `dev-engineer-toolkit` → `get-config.sh --key systemPrompt`（及 `openingChatMsg`）。若平台 **空/占位** 且用户已描述 Agent → **先于施工**走 [part5-prompt-design.md](part5-prompt-design.md) § 用户输入提炼 |
| 3 | 读当前项目文档 | `docs/README.md`（索引）→ `glossary.md` → `flow-graph-rules.md` → `node-catalog.md` → `node-kit.md` → `config/flow-agent.config.json` |
| 4 | 简报 | 项目状态 + 待办，再处理用户指令 |

**平台配置**：读写平台在线配置（`systemPrompt` / `tools` / `skills` 等）一律经 `dev-engineer-toolkit`（禁止只改本地）。

---

## Phase 1：需求分析与形态确认

### 第 0 问：形态确认（一律 default ReAct）

**先读取当前工作目录 `docs/examples.md`**：唯一开发路径是 **default ReAct flow**（`flow.active: "default"`）。固定阶段顺序、人审确认、多源汇总等需求不改图——以平台工具承接固定步骤、systemPrompt 约束流程顺序与确认话术落地；不向用户展开模式细节，直接按 ReAct 路径施工。

1. **确认 runtime profile**：`pnpm flows -- --json`；`pnpm flows -- recommend --kind chat`（注册表仅 `default`，用于确认形态）
2. **系统提示词并行** → 用户 Agent 描述按 [part5](part5-prompt-design.md) § 用户输入提炼 **持续合并**；定稿后尽早同步平台，禁止收工仍空 `systemPrompt`
3. **落地** → `flow.active: "default"`（不改图、不设节点）+ 平台能力登记（[part3-tools-config.md](part3-tools-config.md)）→ 进 Phase 2
4. **流程顺序 / 确认话术约束** → 写进 systemPrompt（如「先调用 X 工具获取数据，再总结输出；产出前先复述要点」），由默认 ReAct 承接

### 平台能力门禁（Phase 1 必做 · 施工前）

凡依赖**工作区以外**的能力，**必须先**完成 [part3-tools-config.md](part3-tools-config.md) § 平台能力登记，**再**写业务代码。

触发：外部 API / 联网搜索 / ReAct 业务工具 / 平台 Plugin 等。豁免：纯 LLM 对话、仅内置 bash/grep（工作区内）。

| 步 | 动作 |
|----|------|
| 1 | 加载 `dev-engineer-toolkit` + Part 3 § 平台能力登记 |
| 2 | `search-apis.sh` / `search-skills.sh`（按关键词拆词） |
| 3 | 命中 → `add-tool.sh` → `get-config --key tools --full` 确认真实工具名与 schema；经宿主注入或固化进入 `allTools` 供默认 ReAct `bindTools` |
| 4 | 无命中 → 记录关键词与输出，方可自写 app 工具 |
| 5 | **`add-tool` 完成后 → 加载 `flow-debugger`**（收工前必跑 `debug.sh --with-logs`） |

> **禁止**：未搜平台就写外部能力；为已登记能力手写 fetch 包装。联网搜索同样须先登记。

---

## Phase 2：开发实现（default flow · 复用默认图）

1. `flow.active: "default"`，**不写图、不设置节点**（已内置 ReAct + 多轮对话上下文记忆；用户可见输出经 `respond` 节点流式透出）
2. **需平台能力** → 须已完成上文「平台能力门禁」；宿主注入或固化后进入 `allTools`，默认 ReAct `think.bindTools(runtime.allTools)` 按需调用
3. 固定流程顺序 / 人审确认 / 多源汇总等约束 → 写进 systemPrompt（Part 5 提炼）→ 平台同步 → Phase 3
4. 确需新工具且平台确无命中 → [part3-tools-config.md](part3-tools-config.md) § 创建自定义工具（`src/app/` + `createFlowTools()`）

---

## Phase 3：验证（completion gate · 顺序写死）

> **未完成 Phase 3 全部步骤 → 禁止进入 Phase 4 报告、禁止标题写「完成」。** Part 4b 是收工必经，不是「跑不通才读」。

### 步骤（按序执行）

| 序 | 动作 | 说明 |
|----|------|------|
| **3.1** | 静态三连 | `pnpm typecheck && pnpm test && pnpm graph`（迭代期**不要** `pnpm build`） |
| **3.2** | 加载 `flow-debugger` | `add-tool` 后应已加载；收工前若未加载则**立即**加载 |
| **3.3** | 平台真实调试 | `debug.sh --message "…" --with-logs`；依赖平台能力 → **必须** `--expect-tool <工具名子串>` |
| **3.4** | 日志佐证 | `--with-logs` 自动完成；或 `analyze-logs.sh --since 10 [--session <devConversationId>]` |
| **3.5** | 双证通过 | SSE `[OUTCOME] PASS` **且** 日志 `[结论] 日志正常`（或 `SSE PASS + 日志佐证通过`） |

```bash
pnpm typecheck && pnpm test && pnpm graph
# 然后（收工必经）：
./scripts/debug.sh --message "…" --expect-tool <工具名子串> --with-logs --auto-approve
```

### 开发快检 vs 收工门禁

| 命令 | 用途 | 能否作收工/端到端证据 |
|------|------|----------------------|
| `pnpm flow "…"` / `pnpm flow -- -i` | 本地 CLI 快检、迭代看输出 | **否** |
| `pnpm flows` / `pnpm graph` / `pnpm capabilities` | profile / 拓扑 / 能力清单（**禁止 `pnpm exec tsx`**） | 仅静态三连组成部分 |
| `flow-debugger` `debug.sh --with-logs` | 平台预览会话真实链路 + 日志佐证 | **是（唯一）** |

- **迭代快检**：开发中可用 `pnpm flow` 或 `debug.sh` 短 prompt 加速；**不得**据此写「端到端验证通过」
- **真实运行门**：收工**仅认** flow-debugger；本地 `pnpm smoke` / rcoder-cli 已移除
- **前置**：`config.flow.active` 指向当前 flow，平台配置已同步
- **细则**：[part4a-verify-debug.md](part4a-verify-debug.md) + **[part4b-smoke.md](part4b-smoke.md)（收工必读）**
- **排查**：[part4a](part4a-verify-debug.md) § 读日志六步

失败 → 修 → 重跑（至多 5 轮）→ 仍失败如实交回。**Phase 3 未全绿不得 Phase 4。**

---

## Phase 4：报告

> **门禁**：仅当 Phase 3 静态三连 + flow-debugger 双证（SSE + 日志）**均已通过**后，方可撰写本 Phase 并以「完成」收束。

1. 完成了什么（形态 / 工具接线 / systemPrompt 要点）
2. **flow-debugger 证据**（**必填**）：贴 `debug.sh --with-logs` 的 `[OUTCOME]`、`[结论]`、`[flow 状态]`、`[工具调用]` 原始摘要；平台能力 flow 须含 `--expect-tool` 命中。**无本节不得标题写「完成」。**
3. **用户待操作事项、风险与后续**（见下表；**无真待办则整段省略**）
4. `project.md` 已更新（含已登记 targetId、工具名）
5. **平台 `systemPrompt` 非空且已回读**（`openingChatMsg` 若涉及）
6. 提示词提炼来源（用户哪些输入 → 哪一字段）
7. **需平台能力时**：`search-apis` / `search-skills` / `get-config` 结果摘要（或「已搜索、无命中」+ 关键词）；自写工具须说明平台无命中依据（**联网搜索较常见**，须单独列出搜索关键词）

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

报「完成 / done」前逐条贴证据。绝对禁止项见开发 Agent `system-prompt.md` `<DEVELOPMENT_CONSTRAINTS>`；细则见 [part4a](part4a-verify-debug.md) + [part4b](part4b-smoke.md)。

- [ ] Phase 3 顺序完成：静态三连 → `load_skill flow-debugger` → `debug.sh --with-logs`（平台能力 `--expect-tool`）→ 日志 `[结论] 正常`
- [ ] **未用 `pnpm flow` 冒充端到端**；**未用 `pnpm exec tsx`**（应用 `pnpm graph` / `pnpm flows` 等 scripts）
- [ ] 声称改动文件经 `read_file` / `ls` 实证
- [ ] `.logs/` 无未预期 `error`（**已跑 analyze-logs 并贴 `[结论]` 摘要**）
- [ ] `get-config.sh --key systemPrompt` 回读**非空**；用户发过 Agent 描述 → 已按 part5 提炼并同步
- [ ] 未改 `src/app/graph.ts` / 未注册新 flow（一律 default ReAct；`flow.active` 保持 `"default"`）
- [ ] **需平台能力** → 已贴 search / get-config **原始输出**；有命中 → `add-tool.sh`；无命中 → 报告写明关键词后方可自写工具
- [ ] **平台能力真实调用** → `debug.sh --expect-tool` 通过，已贴工具调用轨迹

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
