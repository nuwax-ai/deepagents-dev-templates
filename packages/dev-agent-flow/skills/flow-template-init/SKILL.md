---
name: flow-template-init
description: "检测 deepagents-flow-ts 分层架构、目录结构、import 方向规则、示例对照表"
tags: [template, init, structure, zones, flow, layering]
version: "2.0.0"
---

# 模板初始化检测（Flow 版）

## When to Use
开始任何开发任务前，必须先执行此技能了解 flow-ts 模板项目结构。

## 检测步骤

### Step 1: 确认模板类型

检查项目根目录的 `package.json`：
- `name` 包含 `deepagents-flow-ts`
- `type` 为 `"module"`（ESM）
- `dependencies` 包含 `@langchain/langgraph`、`deepagents-acp`、`@langchain/mcp-adapters`
- **自包含**：不依赖 deepagents-app-ts（底层运行时全部在 `src/runtime/` 内）

这是 **TypeScript 工作流编排模板**（仅 TS，无 Python 版）。

### Step 2: 读取配置

读取 `config/flow-agent.config.json`，关注：
- `agent` — 名称、描述、版本、`systemPromptPath`（默认 `prompts/flow.base.md`）
- `model` — provider（`openai` / `anthropic`）、name（默认 `deepseek-chat`）、settings
- `mcp` — configPath、mergeStrategy
- `permissions` — mode、allowedPaths、deniedPaths
- `sandbox` — profile、writablePaths、deniedWritePaths
- `skills` — directories、progressiveLoading
- `compaction` — 上下文压缩配置
- `middleware` — stuckLoopDetection、periodicReminder、costTracking

### Step 3: 扫描分层架构（核心 — 重构后的目录结构）

```
src/
  core/          # 契约层（L1，纯类型、零依赖）：flow-types.ts（FlowCallbacks/FlowExecutor/StatefulFlow/事件）
  runtime/       # 底层运行时（L2，自包含、保护）—— 按职责聚合成子模块
    index.ts     #   barrel（公开 API）；flow-config.ts=配置加载；flow-runtime.ts=FlowRuntime 接口；logger/version
    config/      #   配置 schema + 三层加载（config-loader/merge/paths/schema/sources/deep-merge）
    platform/    #   平台 client + 变量管理
    context/     #   运行时上下文装配 + 发现 + 模型/提示词解析（discovery/model/prompt/runtime-context/helpers）
    fs/          #   文件 / 搜索 / 沙箱（path-utils/ripgrep/sandbox）
    services/    #   checkpoint / LLM 韧性 / MCP stdio
  app/           # 默认 ReAct 图（L3，可改）
    graph.ts     #   只做「建节点 + 连边」（图是契约）
    nodes/       #   节点实现：prepare（纯函数）/ think / tools / respond（工厂模式）
    tools/       #   全部内置工具：bash/fs/search/demo/mcp-bridge + http/json/platform_api/agent_variable
    state.ts     #   FlowStateAnnotation
    compaction.ts #  上下文压缩
  surfaces/      # ACP / CLI 适配器（L4，保护）
  compose/       # 组合根（L4，保护）：createFlowRuntime 装配 runtime + tools
  index.ts       # 入口 / 装配
examples/        # 参考库（只读，新 flow 在此新建目录，不修改已有范例）
config/          # flow-agent.config.json、mcp.*.json
prompts/         # flow.base.md
skills/          # SKILL.md（builtin/）
.agents/         # 声明式 subagent（agents/<name>/AGENT.md）
tests/           # 默认图单测 + 分层守卫（layering.test.ts）
```

### Step 4: 确认 import 方向规则（分层强制）

```
core -> runtime -> app -> { surfaces | compose } -> index.ts
(纯契约) (底层运行时) (默认图)   (适配器 | 组合根)      (入口/装配)
```
- 只能向左 import（下行依赖合法）
- `surfaces` 与 `compose` 平级，互不引用
- 跨层向下装配只许出现在 `compose/` 和 `index.ts`
- 该规则由 `tests/layering.test.ts` **强制**——违规会让测试变红

### Step 5: 确认保护区边界

| 区域 | 路径 | 规则 |
|------|------|------|
| 契约 | `src/core/` | 纯类型；改契约需同步 app + surfaces |
| 底层运行时/适配器/组合根 | `src/runtime/`、`src/surfaces/`、`src/compose/` | 禁止修改（除非用户明确要求） |
| 默认图 | `src/app/`（graph.ts 连线 + nodes/ 节点 + tools/ 工具） | 可改 |
| 参考（只读） | `examples/` | 阅读学拓扑，不修改不新建 |
| 开发工作区 | `src/app/` | graph.ts + nodes/ + tools/ |
| 配置 | `config/`、`prompts/`、`skills/`、`.agents/` | 按需扩展 |

### Step 6: 安装依赖与验证

```bash
pnpm install
pnpm build
pnpm test          # 含 tests/layering.test.ts 分层守卫
pnpm typecheck
```

### Step 7: 查询能力分层

```bash
pnpm exec tsx src/index.ts capabilities    # 输出可用工具/MCP/skills（无凭证）
pnpm graph                                  # 导出默认图拓扑
```

## 示例对照表（拓扑选型核心依据）

| 目录 | 场景 | 拓扑 | LangGraph 特性 | Flow 类型 |
|------|------|------|---------------|-----------|
| `examples/rag` | 检索增强、条件重试 | 线性链 + 重试环 | addConditionalEdges | one-shot |
| `examples/travel-planner` | 并行调研聚合 | Send 扇出 + reducer | Send + HITL | stateful |
| `examples/project-manager` | 分解->评估->审批 | reflection 回边 | 条件边 + interrupt | stateful |
| `examples/human-in-loop` | 生成->人审->定稿 | 线性 + 中途暂停 | interrupt + resume | stateful |
| `examples/dev-agent` | 综合能力展示 | ReAct + subgraph | bindTools + compact | stateful |
| `examples/deep-research` | 长任务报告 | 多阶段流水线 | 双层 reflection + Send | stateful |

## 输出格式
```
模板检测结果：
- 模板类型：deepagents-flow-ts（TS 工作流编排，自包含）
- 模板版本：X.Y.Z
- Agent 名称：xxx
- 默认模型：provider:name
- 分层结构：core / runtime / app / compose / surfaces
- 现有示例：N 个（列出名称）
- 现有工具：N 个（列出名称）
- MCP 服务器：N 个
- 待处理事项：（如有缺失配置）
```

## Anti-patterns
- 跳过检测直接写代码 — 可能误改保护区
- 把 flow-ts 当 tool loop 模板对待 — 范式完全不同（显式图 vs 自由循环）
- 违反分层 import 方向（app import surfaces） — layering.test.ts 会变红
- 忽略 examples/ 对照表 — 新 flow 应先选最接近的范例
- ✅ 每次开发任务开始前都执行检测
- ✅ 确认分层 import 方向（core → runtime → app → surfaces/compose）
