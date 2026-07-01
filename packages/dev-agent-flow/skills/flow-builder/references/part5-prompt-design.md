# Part 5：目标 Agent 提示词设计

> 所属：`flow-builder` L2-E。入口路由见 [SKILL.md](../SKILL.md)。
> **写什么**在本层；**怎么存**经 `dev-engineer-toolkit`（见下方「保存与同步」）。

为基于 `deepagents-flow-ts` 开发的**业务 Agent（主 Agent / 目标 Agent）** 设计系统提示词 / 开场白。产出的是目标 Agent 运行时读取的提示词，不是开发 Agent 自身提示词，**也不是** `.agents/agents/<name>/AGENT.md` 子智能体。

## 用户输入提炼与平台同步（提示词提炼事务）

本节为**用户输入提炼与平台同步**的完整步骤。事务分 **提炼 → 定稿 → 同步**；默认无需用户确认。

### 提炼铁律

用户在本会话**发送的一切**与目标 Agent 相关的内容，须**汇总提炼**为结构化系统提示词并同步平台 —— **不是**原样粘贴聊天记录，而是按下方七要素归纳。

| 用户输入类型 | 落点 |
|-------------|------|
| 角色、职责、能力、语气、输出格式、约束、few-shot | **`systemPrompt`**（主载体，**平台不得为空**） |
| 首条欢迎语、开场话术 | **`openingChatMsg`** |
| 智能体名称 | `config/flow-agent.config.json` → `agent.name` |

**持续合并**：每收到相关消息 → 与已有定稿合并；碎片信息 → 主动补全七要素；只描述图/工具未写系统提示词 → **反推**最小 `systemPrompt`（角色+能力+约束），禁止留空。

**禁止**：口头确认不落盘；收工平台 `systemPrompt` 仍空/占位；只改图不提炼用户已发描述。

### 何时触发（识别即做）

- 用户首条或任意消息描述要什么 Agent / 对谁说话 / 什么风格
- 新建、命名、定制主 Agent / 通用智能体（非 subagent，见 Part 6）
- 调整 `systemPrompt` / `openingChatMsg`
- 脚手架需场景 `systemPrompt`（part1）
- Phase 0 发现平台 `systemPrompt` 为空但用户已描述需求（[part0-workflow.md](part0-workflow.md)）

### 定稿步骤

| 步 | 动作 |
|----|------|
| 1 | 汇总本会话用户输入并提炼（上表落点） |
| 2 | 确认主 Agent（见 § 主 Agent 命名与身份） |
| 3 | 按下方「设计流程」+ 七要素 + ≥1 few-shot（有固定格式时） |
| 4 | 名称 → 更新 `config.agent.name` / `agent.description` |
| 5 | 写入 `prompts/flow.base.md`（开场白单独文件，UTF-8） |
| 6 | 需要时填入 part1 的 `systemPrompt`；摘要写入 `project.md` |
| 7 | **有定稿即同步** — 同轮或下轮执行「平台同步」，勿拖到收工 |

### 平台同步（报「完成」前强制）

只要用户发过 Agent 相关描述，或已完成定稿，报「完成 / done」**之前**必须：

| 步 | 动作 |
|----|------|
| 1 | 加载 `dev-engineer-toolkit` |
| 2 | `update-config.sh --system-prompt-file …`（及 `--opening-msg-file`；中文**必须用文件**） |
| 3 | `get-config.sh --key systemPrompt` 回读：**非空**、与定稿一致、反映用户意图 |
| 4 | Phase 4 简报字段名、本地源文件、校验结果 |

**不得报「完成」**：仅本地未同步；回读不一致；**`systemPrompt` 为空或过短无效**。

---

## 主 Agent 命名与身份（创建 / 通用智能体）

用户说「创建智能体」「通用智能体」「名字叫 X」时走本 Part，**禁止**创建 `AGENT.md`。

| 步 | 动作 | 文件 / 字段 |
|----|------|-------------|
| 1 | 确认 `activeFlow: "default"`（通用 ReAct；无需 scaffold） | `config/flow-agent.config.json` |
| 2 | 写入智能体名称与简述 | `agent.name`、`agent.description` |
| 3 | Part 5 七要素设计 systemPrompt（标题 `# [Agent 名] — …`） | `prompts/flow.base.md` |
| 4 | 若用户要欢迎语 → 写开场白源文件 | 如 `prompts/opening.md` |
| 5 | 平台同步（见上节） | `update-config.sh` → `systemPrompt` / `openingChatMsg` |

**主 Agent 没有 `AGENT.md` 文件。** 名称落在 `config.agent.name` 与 prompt 标题，不是 `.agents/agents/` 目录。

**「开场白」歧义**：用户说「名字叫做开场白」→ 名称是「开场白」，**不等于**只改 `openingChatMsg`；除非用户明确要改欢迎语文案。

与 Subagent 区分：子智能体 → **平台** 或 `builtin/agents/`；**禁止** `.agents/`（Part 6）。

## 核心原则

1. **结构化 > 自由发挥** — 覆盖「七要素」，不即兴空写。
2. **few-shot 是质量分水岭** — 有固定格式/语气/结构时，**必须** ≥1 个「输入 → 期望输出」示例。
3. **存线上不硬编码** — 经 `dev-engineer-toolkit` 同步 `systemPrompt` / `openingChatMsg`；禁止写进 `src/runtime/` 或节点代码。
4. **保存须同步** — 上传后 `get-config.sh` 回读校验（见 § 用户输入提炼与平台同步）。
5. **只改一字段就省略另一字段** — 勿传空开场白/系统提示词覆盖原值。
6. **工具名与登记一致** — 提示词里点名的工具须是 `dev-engineer-toolkit` 已 `add-tool.sh` 注册的同一项。

## 设计流程（5 步）

| 步 | 动作 |
|----|------|
| 1 | 场景识别（用户、输入输出、工具/知识库） |
| 2 | 选场景模板（A–D 或通用七要素） |
| 3 | 填充七要素 + **至少 1 个 few-shot** |
| 4 | 过 checklist |
| 5 | 按 § 用户输入提炼与平台同步 +「保存与同步」上传 |

与 scaffold 衔接：写好后填入 [part1-scaffold.md](part1-scaffold.md) 的 `systemPrompt`（若该 topology 注入 prompt）。

## 节点 prompt vs 主 Agent systemPrompt

| 层级 | 用途 | JSON 要求 |
|------|------|-----------|
| `prompts/*.md` / 平台 `systemPrompt` | 角色、能力、风格、兜底 | 通常**自然语言** |
| **图节点** `SystemMessage`（`createLlmNode` 的 `prompt`） | 单步任务契约 | **仅当**该节点有 `parse` 且 `write` 读 `r.parsed` |

**入口 LLM 节点**（`__start__` 后第一个 llm）prompt 建议含兜底句：

> 若输入不符合预期格式，友好说明并引导用户提供正确格式；不要输出 JSON（除非本节点 `write` 依赖 `r.parsed`）。

节点级 `parse` 契约见 `docs/flow-graph-rules.md` **R-G001 / R-G002**；node-kit 有摘要。

## 保存与同步

经 `dev-engineer-toolkit` 将定稿写入平台在线配置，禁止只改本地不同步：

1. **落盘** — 定稿写入本地 UTF-8 源文件（如 `prompts/flow.base.md`；开场白单独文件）
2. **上传** — `update-config.sh --system-prompt-file` / `--opening-msg-file`（含中文必须用文件，禁止命令行内联）
3. **单字段更新** — 只改系统提示词或开场白之一时，勿传空值覆盖另一字段
4. **scaffold 衔接** — 需要时填入 part1 的 `systemPrompt`（若该 topology 注入 prompt）

回读校验见 § 用户输入提炼与平台同步 · 平台同步。

## 七要素骨架

```markdown
# [Agent 名] — [领域] 助手

你是 **[角色]**，服务 **[目标用户]**，专注 **[场景]**。

## 核心能力
- [能力1，动词开头，具体]（3–5 条）

## 工作方式
理解需求 → 按需调工具 → 观察结果 → 回答；不足则查或问，不臆测。

## 工具使用
- [工具A]：场景 + 入参（名须与已注册工具一致）

## 领域知识与约束
- [规则 / 边界 / 禁区]

## 输出规范
- 格式 / 语气 / 长度

### 示例（few-shot）
输入：…
输出：…

## 兜底
- 信息不足 / 超范围如何处理
```

## 场景模板库

| 模板 | 特征 | 要点 |
|------|------|------|
| **A 客服+RAG** | 知识库问答、引用来源 | 先检索再答；检索到/不到各 1 few-shot |
| **B 内容生成** | 风格化文案、固定结构 | 完整「主题→成品」few-shot；标题/标签规范 |
| **C 数据分析** | SQL/看板、结论解读 | 先确认口径；SQL 契约写 `project.md` |
| **D 任务工具型** | 意图→工具→结果 | 副作用操作前确认；工具调用 few-shot |

## checklist（保存前）

- [ ] 角色/用户/场景一句说清
- [ ] 能力 3–5 条具体；工具名已配置
- [ ] ≥1 few-shot（有固定格式时）
- [ ] 有兜底；无矛盾指令
- [ ] 已按 § 平台同步完成上传与回读（`systemPrompt` 非空）

## Anti-patterns

- ❌ 把「创建/命名通用智能体」建成 `.agents/agents/<name>/AGENT.md`（子智能体只走平台，见 Part 6）
- ❌ 只有空泛角色能力，无工具指引/few-shot/输出规范
- ❌ 未配置工具名写进提示词
- ❌ 硬编码进代码；只改本地不同步平台
- ❌ 所有 LLM 节点 prompt 都写「只输出 JSON」（应仅用于 `write` 读 `r.parsed` 的节点）
- ✅ 七要素 + few-shot → `dev-engineer-toolkit` 保存 → § 平台同步 → 填 scaffold spec（如需）
