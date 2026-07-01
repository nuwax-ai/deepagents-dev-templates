# Part 0：端到端开发流程

> 所属：`flow-builder` L2-A（总流程）。入口路由见 [SKILL.md](../SKILL.md)。
> system-prompt 的 `<WORKFLOW>`、`<BOOTSTRAP_FIRST>` Phase 0、`<SCAFFOLD_FIRST>`、`<COMPLETION_GATE>` **逐步实现**在本层及各 Part；system-prompt 只保留铁律与约束。

## 会话启动（先于一切开发）

| 步 | 动作 | 细节 |
|----|------|------|
| 0 | 装依赖 | `package.json` 且无 `node_modules`/lock 变更 → `pnpm install`；`pyproject.toml` 且无 `.venv` → `uv sync --group dev` |
| 1 | 读上下文 | `README.md`、`project.md`（无则创建，见 system-prompt `<PROJECT_MEMORY>`） |
| 2 | 系统提示词基线 | `dev-engineer-toolkit` → `get-config.sh --key systemPrompt`（及 `openingChatMsg`）。若平台 **空/占位** 且用户已描述 Agent → **先于写图**走 [part5-prompt-design.md](part5-prompt-design.md) § 用户输入提炼 |
| 3 | 读模板文档 | `docs/glossary.md` → `flow-graph-rules.md` → `node-catalog.md` → `node-kit.md` → `config/flow-agent.config.json` |
| 4 | 简报 | 项目状态 + 待办，再处理用户指令 |

**平台配置**：读写 `<PLATFORM_CONFIG>` 一律经 `dev-engineer-toolkit`（禁止只改本地）。

---

## Phase 1：需求分析与 topology 选型

1. **脚手架优先** → [part1-scaffold.md](part1-scaffold.md)（9 topologies = 8 presets + `custom`）
2. **系统提示词并行** → 用户 Agent 描述按 [part5](part5-prompt-design.md) § 用户输入提炼 **持续合并**；定稿后尽早同步平台，禁止收工仍空 `systemPrompt`
3. **命中 preset** → 写 spec → `node scripts/scaffold/generate.mjs <spec>` → 改 `activeFlow` → 进 Phase 2 生成路径
4. **不命中** → 先用 `custom`；仍不行 → [part2-orchestration.md](part2-orchestration.md) 手写

### 平台能力门禁（Phase 1 必做 · 写图前 · 通用）

凡 Agent 依赖**工作区以外**的能力，**必须先**完成 Part 3 § 平台能力登记，**再**写 spec / `graph.ts` / `flow-tools.ts` / 自写 `*.tool.ts`。

**触发（满足任一）**：

- 用户要调用外部 API、第三方数据、业务 Plugin、知识库、MCP、平台技能
- 用户要联网 / 搜索 / 实时资讯 / 多源调研（**较常见**；另见 Part 3 § 联网搜索）
- 计划使用：`createToolExecNode` · `createMcpRetrievalNode` · `bindTools` · `flow-tools.ts` 新增工具 · `rag`/`adaptive-rag` 检索 · ReAct 接业务工具
- topology：`react-tools` · `dev-agent` · `rag` · `adaptive-rag` · `travel-planner` · `deep-research` · custom 含 `tool-exec` / `mcp-retrieval`

**豁免（仍须 Part 3 知情，但可不 add-tool）**：纯 LLM 对话、无外部 I/O；仅内置 `bash`/`read_file`/`grep`（工作区内）。

| 步 | 动作 |
|----|------|
| 1 | 加载 `dev-engineer-toolkit` + [part3-tools-config.md](part3-tools-config.md) § 平台能力登记 |
| 2 | 按能力拆词：`search-apis.sh --kw "<关键词>"`（可多轮）；需技能 → `search-skills.sh` |
| 3 | `get-config.sh --key tools` / `mcpConfigs` / `skills`（按需） |
| 4 | 命中 → `add-tool.sh` 或对齐 MCP → `src/app/` 包装 → `flow-tools.ts` 或图内接线 → `project.md` 记 targetId |
| 5 | 平台确无命中 → 记录关键词与输出，**然后**方可走优先级 4 自写 app 工具 |
| 6 | **然后**写 spec / `graph.ts` |

> **禁止**：先写占位工具 / `SEARCH_MCP = undefined` / 空 `flow-tools.ts` 再 smoke 报完成，把平台登记甩给「用户待操作」。**联网搜索**是高频场景，同样不得跳过登记。

### Factory 速查（手写路径）

| 需求 | Factory |
|------|---------|
| 用户可见大段 LLM 文本 | **`createLlmStreamNode`**（`r.text`；spec `llm-stream`） |
| 中间 JSON / 结构化 | `createLlmNode`（`r.parsed` 时） |
| LLM 裁决路由 | `createLlmRouterNode` |
| MCP 检索 | `createMcpRetrievalNode` |
| tool_calls | `createToolExecNode` |
| HITL interrupt | `createHumanApprovalNode` |
| HITL 后置定稿 | `createApprovalFinalizeNode` |
| 同 turn 工具审批弹窗 | `createPermissionApprovalNode` |
| input→HumanMessage | `createPrepareNode` |
| Send 并行 | `createFanout` |
| 子图 | `createSubgraphNode` |

### examples/ 对照（只读，6 个）

`rag` · `travel-planner` · `project-manager` · `human-in-loop` · `dev-agent` · `deep-research`  
路由+自纠正检索 → scaffold topology `adaptive-rag`（非 `examples/` 目录）

---

## Phase 2：开发实现

### 路径 A · 命中 preset 或 custom scaffold

1. **需平台能力** → 须已完成上文「平台能力门禁」
2. spec → `generate.mjs` → `activeFlow` → part1 自验 → Phase 3

### 路径 B · Bespoke 手写

| 步 | 动作 |
|----|------|
| 1 | 读最接近 `examples/`（只读） |
| 2 | `src/app/`：`graph.ts` 连线、`nodes/`、`flow-tools.ts` |
| 3 | 节点优先 factory；bespoke 须说明原因 |
| 4 | `Annotation.Root`；Send 并行加 reducer |
| 5 | 节点返回 Partial；禁止 mutate state |
| 6 | 图规则 → 目标项目 `docs/flow-graph-rules.md`（**R-G001+**） |
| 7 | 用户可见输出 → **R-G009** `createLlmStreamNode` + `r.text`；手改 graph 同步 spec（**R-G003**） |
| 8 | 工具 → [part3-tools-config.md](part3-tools-config.md) → `src/app/` → `createFlowTools()` |
| 9 | 系统提示词 → [part5](part5-prompt-design.md)；填 scaffold `systemPrompt`（若 topology 注入） |
| 10 | 更新 `project.md` |

编排细节 → [part2-orchestration.md](part2-orchestration.md)

---

## Phase 3：验证（completion gate）

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm graph && pnpm smoke
```

- **ACP 真实运行门**：本地优先 `pnpm smoke`（rcoder-cli）；禁止 `--dry-run` 冒充通过
- **前置**：模型凭证（`.env` / NuWaClaw `OPENCODE_*`）+ `config.activeFlow` 指向当前 flow
- **细则**： [part4a-verify-debug.md](part4a-verify-debug.md) + [part4b-smoke-acp.md](part4b-smoke-acp.md)
- **排查**： [part4a](part4a-verify-debug.md) § 读日志六步、典型错误

失败 → 修 → 重跑（至多 5 轮）→ 仍失败如实交回。

---

## Phase 4：报告

1. 完成了什么（topology / 节点 / 关键图能力）
2. 用户待操作事项、风险与后续（**不含**开发 Agent 可代劳的平台工具/MCP/技能登记）
3. `project.md` 已更新（含已登记 targetId、MCP 名、工具名）
4. **`<PLATFORM_CONFIG>.systemPrompt` 非空且已回读**（`openingChatMsg` 若涉及）
5. 提示词提炼来源（用户哪些输入 → 哪一字段）
6. **需平台能力时**：`search-apis` / `search-skills` / `get-config` 结果摘要（或「已搜索、无命中」+ 关键词）；自写工具须说明平台无命中依据（**联网搜索较常见**，须单独列出搜索/MCP 关键词）

---

## completion gate 收尾清单

报「完成 / done」前逐条贴证据（详述见 [part4a](part4a-verify-debug.md)）：

- [ ] 五连命令退出 0（`build` / `typecheck` / `test` / `graph` / `smoke`）
- [ ] 声称改动文件经 `read_file` / `ls` 实证
- [ ] `.logs/` 无未预期 `error`
- [ ] `get-config.sh --key systemPrompt` 回读**非空**；用户发过 Agent 描述 → 已按 part5 提炼并同步
- [ ] 用户可见 LLM 节点 → `createLlmStreamNode` + `r.text`（**R-G009**）
- [ ] **需平台能力**（见 Phase 1「平台能力门禁」）→ 已贴 `search-apis.sh` / `search-skills.sh` 与/或 `get-config.sh --key tools|mcpConfigs|skills` **原始输出**；有命中 → 已 `add-tool.sh` 并接线；无命中 → 报告写明关键词与「已搜索、无命中」后方可自写工具。**联网搜索较常见**，须含 `mcpConfigs` 或搜索关键词证据。**未搜平台即报完成 = 不通过**

---

## Context7（LangGraph TS API）

```
resolve-library-id(libraryName: "langgraph", query: "langgraph javascript typescript StateGraph interrupt")
query-docs(libraryId: "/langchain-ai/langgraphjs", query: "StateGraph interrupt Command resume")
```

- 只用 TS 版；每问题 ≤3 次；query 带 `javascript`/`typescript`
- 参考：<https://docs.langchain.com/oss/javascript/langgraph/overview>

---

## 开发 Agent 内置工具（libs/tools + flow-tools）

| 工具 | 用途 |
|------|------|
| `bash` / `read_file` / `write_file` / `edit_file` | shell / 文件 |
| `grep` / `glob` | **仅工作区**检索（非联网） |
| `http_request` / `json_utils` | HTTP / JSON |
| `load_skill` / `task` | skill 加载 / 平台 subagent 委派 |
| `echo` / `calculate` / `time` | demo fallback |

Native MCP：`config/mcp.default.json` + ACP session `mcpServers`（无 `mcp_tool_bridge`）。
