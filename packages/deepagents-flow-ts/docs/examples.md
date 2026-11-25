# 默认 ReAct 路径与交付底座

本包**只提供默认 ReAct flow**（`flow.active: "default"`，见 [`src/app/graph.ts`](../src/app/graph.ts)）：`prepare → think ↔ tools → respond`。注册表仅 `default`，`flow.active` 配置其他值启动直接报错（不回落）。所有需求（含固定阶段顺序、人审确认话术、多源检索等）一律以默认 ReAct + 平台能力 + systemPrompt 落地。Factory API 详见 [node-kit.md](./node-kit.md)，节点选型见 [node-catalog.md](./node-catalog.md)。

## 先判定：default 已经够用

| 需求 | 做法 | 是否改图 |
|------|------|----------|
| 开放追问、客服、通用助手、搜索总结；以及模糊/未指明形态 | `flow.active: "default"` + systemPrompt + 平台能力登记 | 否 |
| 让模型按需调用平台工具 / MCP 工具 | 平台登记后由宿主注入会话，默认图 `think.bindTools(runtime.allTools)` | 否 |
| 固定阶段顺序、人审确认、多源汇总 | 以默认 ReAct 落地：工具承接固定步骤，systemPrompt 约束流程顺序与确认话术 | 否 |

> `flow.active` 仅允许 `"default"`，配置其他值启动报错；默认图已具备多轮记忆、checkpoint、自动压缩、流式响应和工具调用回路。

## 交付底座：默认路径全部内置

| 能力 | 机制 | 默认路径 |
|------|------|----------|
| 多轮持续会话 | 稳定 `threadId` + Messages 历史累积 | `createStatefulFlow({ conversational: true })`，默认图已开 |
| checkpoint | `FileCheckpointSaver` 落盘，跨重启恢复 | runtime 注入 `checkpointer`，图 `.compile({ checkpointer })` |
| 自动压缩 | `applyCompaction` 超阈值摘要写回 | `createStatefulFlow` + `appConfig` + `config.compaction` |
| 工具事件 | `createToolExecNode` / `runTool` 三态回调 | surface 注入 callbacks |

默认图经 `src/index.ts` 的 `materializeFlow → createStatefulFlow` 物化，禁止手写外层 run-loop。

## 默认 ReAct + 平台能力

开放对话 + 工具调用直接走默认图，不写 graph：

1. 在平台侧登记 Plugin / Workflow / Knowledge / MCP。
2. 已登记工具进入运行时：**宿主注入**，或开发期把真实 schema **固化为** `FlowDef.platformToolRefs` 再经 `createFlowRuntime` 装配为 `StructuredTool`，并入 `runtime.allTools` 供默认 ReAct `think` 中 `bindTools`。
3. 把领域说明写进 systemPrompt，例如“需要实时信息时优先调用已登记搜索工具，汇总来源后回答”；需要固定流程顺序或确认话术时，同样以 systemPrompt 约束。
4. 本地快检：`pnpm flow "…"`；端到端在平台预览会话经 ACP 验证。

运行时关系：平台宿主可把已登记能力注入会话；固化路径经 `createPlatformStructuredTool` 生成工具后并入 `runtime.allTools`。

## 不要做的事

- 不要在 `src/app/flows/` 注册新 flow；`flow.active` 仅允许 `"default"`（其他值启动报错）。
- 不要恢复 `scripts/scaffold/` 或 `libs/topologies/` 作为入口。
- 不要手写外层 run-loop；走 `createStatefulFlow`。
- 不要把平台工具名字符串直接传给 `createToolExecNode.tools`。
