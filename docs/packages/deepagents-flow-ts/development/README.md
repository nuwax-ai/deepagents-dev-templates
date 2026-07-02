# deepagents-flow-ts — 开发文档总索引

> **受众**：Monorepo 维护者（改 `packages/deepagents-flow-ts` 源码、surface、拓扑、ACP 对齐时查阅）。  
> **不是**模板使用者文档。终端用户 / 在模板内建 flow 请看包内 [README.md](../../../../packages/deepagents-flow-ts/README.md) 与 [docs/](../../../../packages/deepagents-flow-ts/docs/)。

本目录收录 **维护方案、架构决策、协议对齐、重构计划** 等开发向文档。包内的 `node-kit.md`、`flow-patterns.md`、`zed-debug.md` 等属于**使用者参考**，留在 `packages/deepagents-flow-ts/docs/`。

---

## 快速入口

| 我要… | 文档 |
| --- | --- |
| 理解默认 ReAct 图为何 `think` + `tools` 分两节点 | [react-two-phase.md](./react-two-phase.md) |
| 查 MCP / Skill / Subagent 加载、运行、停止 | [runtime-capabilities-lifecycle.md](./runtime-capabilities-lifecycle.md) |
| 理解 ask-question MCP 与 HITL 三种形态选型 | [ask-question-mcp-hitl.md](./ask-question-mcp-hitl.md) |
| 跟进 ACP 协议对齐与工具出站 | [acp/README.md](./acp/README.md) |
| 查 LangGraph 原生能力收敛计划 | [langgraph-native-convergence.md](./langgraph-native-convergence.md) |
| 查拓扑 scaffold 重构 code-review 修复计划 | [topology-scaffold-review-fixes-plan.md](./topology-scaffold-review-fixes-plan.md) |
| 查 RAG 早期计划（**已过时，历史归档**） | [rag-agent-plan.md](./rag-agent-plan.md) |

---

## 文档地图

```
development/
├── README.md                           ← 本页（总索引）
├── react-two-phase.md                  ← ReAct 两阶段分工（think bindTools vs tools 节点）
├── runtime-capabilities-lifecycle.md   ← MCP / Skill / Subagent 加载·运行·停止
├── ask-question-mcp-hitl.md              ← 内置 ask-question MCP + HITL 选型（✅ 现行）
├── langgraph-native-convergence.md       ← LangGraph 原生对象收敛开发方案
├── topology-scaffold-review-fixes-plan.md  ← 拓扑积木化重构修复计划（✅ 已落地）
├── rag-agent-plan.md                   ← RAG 早期计划（⚠️ 已过时）
├── acp-spec-alignment.md               ← → acp/ 的跳转页（兼容旧链接）
└── acp/                                ← ACP 协议对齐维护手册（子索引见 acp/README.md）
    ├── README.md
    ├── spec-and-version.md
    ├── architecture.md
    ├── field-mapping.md
    ├── legacy-path.md
    ├── dataflow-nuwaclaw.md
    ├── maintenance.md
    ├── roadmap-progress.md
    ├── human-in-the-loop.md
    ├── permission.md
    ├── phase-c-streaming-research.md
    ├── phase-e-capabilities-research.md
    ├── reference-implementation.md
    └── changelog.md
```

---

## 按主题分类

### 架构与运行时

| 文档 | 状态 | 摘要 |
| --- | --- | --- |
| [react-two-phase.md](./react-two-phase.md) | 现行 | 默认图 ReAct：`bindTools`（决策）与 `ToolNode`（执行）为何拆节点 |
| [runtime-capabilities-lifecycle.md](./runtime-capabilities-lifecycle.md) | 现行 | MCP / Skill / Subagent 装配、session 生命周期与资源边界 |
| [ask-question-mcp-hitl.md](./ask-question-mcp-hitl.md) | 现行 | 内置 ask-question MCP、图内 present_review + interrupt、与 default ReAct 边界 |
| [langgraph-native-convergence.md](./langgraph-native-convergence.md) | 计划中 | surface 流式、MessagesAnnotation、compaction 等向 LangGraph 原生收敛 |

### ACP / Surface

| 文档 | 状态 | 摘要 |
| --- | --- | --- |
| [acp/README.md](./acp/README.md) | 持续更新 | ACP 子目录总索引、当前状态摘要、维护约定 |
| [acp/roadmap-progress.md](./acp/roadmap-progress.md) | 持续更新 | 追赶 claude-code-acp-ts 的阶段进度 |
| [acp/permission.md](./acp/permission.md) | 现行 | 工具审批门控（`onPermissionRequest`） |
| [acp/human-in-the-loop.md](./acp/human-in-the-loop.md) | 现行 | 工具审批 vs 图内 interrupt 审批节点 |
| [acp/dataflow-nuwaclaw.md](./acp/dataflow-nuwaclaw.md) | 现行 | MCP + LangGraph + ACP 全栈数据流 |

完整 ACP 文档列表见 [acp/README.md §快速入口](./acp/README.md#快速入口)。

### 拓扑 / Scaffold

| 文档 | 状态 | 摘要 |
| --- | --- | --- |
| [topology-scaffold-review-fixes-plan.md](./topology-scaffold-review-fixes-plan.md) | ✅ 已完成 | `feat/topology-scaffold` 15 项缺陷修复计划与执行结果 |

### 历史归档

| 文档 | 状态 | 摘要 |
| --- | --- | --- |
| [rag-agent-plan.md](./rag-agent-plan.md) | ⚠️ 已过时 | RAG 内置于 app-ts 的早期方案；现状见 `src/libs/topologies/rag/` |

---

## 包内文档（不迁移，仅交叉引用）

以下留在 `packages/deepagents-flow-ts/`，供模板使用者与 `dev-agent-flow` 直接引用：

| 文档 | 用途 |
| --- | --- |
| [README.md](../../../../packages/deepagents-flow-ts/README.md) | 项目结构、分层、命令、开发规则 |
| [docs/node-catalog.md](../../../../packages/deepagents-flow-ts/docs/node-catalog.md) | 节点选型 |
| [docs/node-kit.md](../../../../packages/deepagents-flow-ts/docs/node-kit.md) | Factory API |
| [docs/flow-orchestration.md](../../../../packages/deepagents-flow-ts/docs/flow-orchestration.md) | 编排速查 |
| [docs/flow-patterns.md](../../../../packages/deepagents-flow-ts/docs/flow-patterns.md) | 进阶 LangGraph 模式 |
| [docs/capabilities.md](../../../../packages/deepagents-flow-ts/docs/capabilities.md) | 能力分层与 builtin / `.agents` 契约 |
| [docs/zed-debug.md](../../../../packages/deepagents-flow-ts/docs/zed-debug.md) | Zed ACP 调试配置 |

---

## 维护约定

1. **新增开发/方案文档** → 放在本目录（或 `acp/` 子目录），并在本页「文档地图」与「按主题分类」登记。
2. **使用者向文档** → 留在包内 `docs/`，在本页「包内文档」交叉引用即可，不迁入 `development/`。
3. **模板包边界** → `packages/deepagents-flow-ts` 的 `src/`、`docs/`、`prompts/`、`examples/`、`scripts/` **不得**引用本 `development/` 路径；维护记录、code-review、方案演进只写在本目录。
4. **ACP 相关改动** → 同步更新 `acp/` 下对应文档；见 [acp/README.md §维护约定](./acp/README.md#维护约定)。
5. **方案已落地或过时** → 在文档头部标状态（✅ / ⚠️），本索引表同步更新。

---

## 相关兄弟包

| 文档 | 位置 |
| --- | --- |
| 开发 Agent（Flow 版）提示词 | `packages/dev-agent-flow/system-prompt.md` |
| app-ts ACP 测试方案 | `docs/packages/deepagents-app-ts/development/acp-test-plan.md` |
