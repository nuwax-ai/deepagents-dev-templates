# Inspector:只读 → 可编辑编排

**状态:** 设计已通过(brainstorm),待生成实现计划
**日期:** 2026-06-09
**范围:** `packages/inspector`(消费 `packages/template` 的公共 API)

## 背景

当前 inspector 产出一个只读的 `AgentOrchestrationSpec` —— 它是 agent 的 `AppConfig`
的投影,外加(`--full` 时)编译出的 LangGraph 拓扑。项目的北极星是做一个
**自托管、in-tree 的 LangSmith / LangGraph Studio 「可视化 + 编辑当前 agent 编排」
能力的对应物**(不依赖 LangSmith 云;配置即真相)。本设计让 inspector **可编辑**:
编辑编排并写回结构化配置 + 可编辑区文本文件。

## 目标 / 非目标

**范围内(v1):**
- 编辑 spec 中呈现的**结构化配置**字段(model、permissions、agent meta、middleware
  开关与参数、compaction/eviction、memory、skills 目录)。
- 编辑**现有的 prompt / skill / subagent 文本**(system prompt 文件、`SKILL.md`、`AGENT.md`)。
- Studio 风格 UI:配置派生的编排图(中)+ 右侧编辑面板。
- 预览 diff → 确认 → 写盘,带 Zod + 保护区两道闸。

**范围外(v1,延后):**
- 增删条目(新建 subagent / skill / MCP server / hook)。
- 编辑 tools(代码定义 —— 等于写 TypeScript)。
- 原始 JSON / Monaco「高级」编辑器(可作为次要入口,后续)。
- 运行线程 / 状态检查 / 时间旅行(Studio 的运行时调试)。

## 关键决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 可编辑范围 | 配置字段 + 现有 prompt/skill 文本 | 即「可编辑编排面」 |
| 编辑深度 | 仅改现有值(不增删) | YAGNI;数据模型简单 |
| 保存模型 | 预览 diff → 确认 → 写 | 写真实项目文件,预览更稳 |
| 布局 | Studio 风格:图居中 + 右侧编辑面板 | 贴合 LangGraph Studio 心智模型 |
| 中间 canvas | 配置派生编排图(dry-run + full) | 编辑无需凭证;`--full` 叠加真实 LangGraph |
| 写回目标 | **源** `app-agent.config.json`(原始未合并)+ 文本文件 | 写回干净;显示合并值 + provenance 徽标 |
| 从 spec 反向投影 | 否决 | spec 是有损投影,round-trip 脆弱 |

## 架构

全部新增代码在 `packages/inspector`。template 只动一处(把它已导出的
`AppConfigSchema` 通过 runtime adapter 暴露出来)。

### 核心抽象 —— `editable-model`

一张声明式表:每个可编辑字段 → `{ configPath(点路径), type(enum|number|string|
boolean|string[]), target(文件), widget }`。单一真相,**同时驱动**右栏 UI 控件
**和**服务端校验/写盘。枚举值与数值范围与 template 的 `AppConfigSchema` 对齐。

### inspector 新增模块

| 模块 | 职责 |
|---|---|
| `editing/editable-model.ts` | 可编辑字段声明(上表)。 |
| `editing/config-source.ts` | 读/写**源** `app-agent.config.json`(原始未合并);用 template 的 `AppConfigSchema` 做 Zod 校验。 |
| `editing/provenance.ts` | 源值 vs 合并 effective 值(来自 `loadConfig`)比对 → 标记被 env / `.deepagents` 覆盖的字段。 |
| `editing/text-files.ts` | 读/写 prompt / `SKILL.md` / `AGENT.md` 文本(保护区守卫)。 |
| `editing/diff.ts` | 算逐文件 before/after diff 供预览。 |
| `editing/writer.ts` | apply:校验 → 保护区守卫 → 乐观并发检查 → 原子写。 |

### server 端点(`src/server.ts`)

- `GET  /api/spec` —— 不变(只读快照,现多一个 `editable` 块)。
- `POST /api/preview` —— body: edits → `{ files: [{path, kind, before, after}], validation }`。
- `POST /api/apply` —— body: edits → 校验 + 写盘 → 返回重跑 inspect 的新 spec。

**edits payload** 为 `{ config: Record<dotPath, value>, text: [{ path, content }] }`:
`config` 是改动的 `app-agent.config.json` 字段按点路径的扁平映射(校验前合并进原始
源文件);`text` 是被编辑的 prompt/skill/subagent 文件的全量替换内容。每个被编辑
文件还带读取时的 `baseHash` 供乐观并发检查。

server 启动时从 CLI 拿到 `workspaceRoot` / `configPath`。

### types(`src/types.ts`)

给 `AgentOrchestrationSpec` 加一个 `editable` 块(每节哪些字段可编辑 + 每字段
provenance),以及 preview/apply 的请求/响应类型。

### template 改动(最小)

扩展 inspector 的 `template-runtime.ts` 的 `TemplateRuntime` 接口,暴露 template
已导出的 `AppConfigSchema`(用于校验)。inspector 依赖 template 的**公共 barrel**
(`src/runtime/index.ts`),因此**不受 template 内部文件移动影响**。所有文件 I/O
由 inspector 自己做(它就是操作一个工作区的工具)。

## UI(`web/graph-ui/`)

- **中间**:配置派生编排图。节点对应 spec 各节(Agent、Model、Prompt、Tools、
  Subagents、Skills、Middleware、Permissions、Memory)。可编辑节点高亮;只读节点
  (Tools = 代码定义,Subagents/Skills.files = 文件发现,Graph)灰显并标「🔒 代码
  定义 / 文件发现」。`--full` 时叠加/可切换真实编译 LangGraph 拓扑。
- **右侧编辑面板**:由 `editable-model` 驱动。按类型给控件 —— enum→下拉、number→
  数字框、boolean→开关、string→文本、string[]→标签列表编辑、prompt/skill→多行
  文本。当源 ≠ 合并值时,字段上挂「被 env 覆盖」徽标(并显示 effective 值)。
  Zod 错误就地提示;非法时「应用」禁用。
- **变更条 + diff 弹窗**:变更计数 → 「查看 diff」→ 逐文件 before/after →
  「应用」/「放弃」(可逐文件勾选)。

## 数据流

```
工作区文件                      inspector(server)                 浏览器 UI
app-agent.config.json(源) ── loadConfig() → 合并 effective
prompts/*.md、SKILL.md、AGENT.md  readConfigSource() → 原始源
                                  provenance: 源 vs effective → 徽标
                                  inspectAgent + editable-model → spec{editable}
   GET /api/spec ───────────────────────────────────────────────► 渲染图 + 表单
                                                                    用户编辑(内存副本)
   POST /api/preview ◄──────────────────────────────────────────── edits
   diff.ts: 逐文件 before/after ─────────────────────────────────► diff 弹窗
                                                                    用户点应用
   POST /api/apply ◄──────────────────────────────────────────────┘
   校验(AppConfigSchema)→ 保护区守卫 → 并发检查 → 原子写
   重跑 inspectAgent → 新 spec ─────────────────────────────────► 重渲染
```

## 校验 & 安全(apply 的几道闸,按序)

1. **配置校验** —— 写盘前对编辑后的源 JSON 跑 `AppConfigSchema.parse()`。失败返回
   字段级错误;UI 高亮该字段;不写盘。
2. **保护区守卫** —— 每个目标路径必须解析到可编辑区(`config/`、`prompts/`、
   `skills/`、`.agents/`)内且在 `workspaceRoot` 内。拒绝 `src/runtime` / `src/surfaces`
   以及任何 `../` / 绝对路径逃逸。复用 template 的 sandbox/deniedPaths 概念(与 agent
   自身遵守的保护同源)。
3. **乐观并发** —— 读取时记录每个目标文件的内容 hash;apply 时若磁盘当前内容 ≠
   该 baseline(被别处改过),拒绝并提示重载。绝不 clobber 外部改动。
4. **原子写** —— 临时文件 + `rename`。
5. **最小 diff** —— `app-agent.config.json` 用 2 空格缩进重序列化(与仓库一致);它是
   纯 `.json`(无注释),不丢信息。
6. **secrets** —— 配置不存密钥(走 env/占位符)。可编辑 `baseUrl` / `apiKeyEnv` 名;
   密钥值不显示也不写入。
7. **dry-run / full 一致** —— 编辑配置不需要 LLM,两种模式行为相同。`--full` 只是多
   一层真实图。

## 测试

自动化测试压在「编辑逻辑 + server 端点」;CDN React-Flow UI 走手验(至多轻量 DOM
冒烟)。沿用 inspector 现有 `INSPECTOR_TEMPLATE_SOURCE=1` 的 vitest。

- **单元**:editable-model 字段→路径映射;`config-source` 读写 round-trip;`provenance`
  (源 vs 合并);`diff` 计算;保护区守卫(放行可编辑区 / 拒绝 runtime 与 `../` 逃逸);
  Zod 拒绝非法值。
- **server**:`/api/preview` 返回预期逐文件 diff;`/api/apply` 写盘 + 返回新 spec;
  `/api/apply` 拒绝(非法配置 / 保护路径 / baseline 过期)。
- **回归**:现有 6 个 inspector 测试保持绿;`GET /api/spec` 与 dry-run/full 只读
  路径不变。

## 未来(v1 之后)

- 增删条目(subagent、skill、MCP server、hook)。
- 原始 JSON / Monaco「高级」编辑器标签作为次要入口。
- Studio 风格运行时调试(线程、状态、时间旅行)—— 单独立项。
