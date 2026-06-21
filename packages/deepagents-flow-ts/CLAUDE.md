# deepagents-flow-ts — AI Agent 项目说明

> 面向**在本仓库工作的 AI Agent**。完整工作区:解压即用、单仓库、单 `package.json`。路径/命令以**仓库根**为基准。
> 本文档只放**每会话必读**的导航 + 规则 + 命令;API 字段/接口/hook 细节见源码与 docs/(需要时再查)。

## 你的职责

搭 **LangGraph 工作流 Agent**(显式节点图 + 条件边 / `interrupt` / `Send`),**不是**自由 tool loop。

1. **建 flow = 组合 `src/libs/nodes/` 的 factory + 在 `src/app/` 连线**。先读 [docs/node-kit.md](docs/node-kit.md)(factory catalog)+ 最接近的 example。
2. 节点**优先用 factory**;只有 bespoke(isApproval 短路、自定义 MCP 检索、反射 Command 路由)才手写。
3. **可改** `src/app/`;**不改** `src/core/`、`src/runtime/`、`src/libs/`、`src/surfaces/`(除非用户明确要求)。
4. 新底层能力 → `src/runtime/` 内扩展,import 指向本项目文件。

## 项目结构 + 分层

```
src/
  core/          纯类型契约(各层共享)
  runtime/       底层运行时(config/model/logger/mcp/checkpoint/llm-resilience + flow-config/flow-runtime)
  libs/          ★ 可复用构建件(保护、消费不改)
    nodes/         节点 factory + 原语(建 flow 用,见 node-kit.md)+ model-resolver(凭证策略)
    tools/         内置通用工具(bash/fs/search/demo/mcp-bridge/http/json/platform-api/agent-variable/skill)
    topologies/    7 拓扑积木(图逻辑单一权威:graph/topology/recipe;scaffold 生成薄封装复用;单向依赖 nodes/+mcp/)
    mcp/           stdio MCP 客户端(callResolvedMcpTool/rateLimited;零 src import,自包含)
    deepagents-acp/  vendored ACP SDK(自包含)
  app/           默认 ReAct 图(★ 可改、开发工作区):graph.ts + nodes/(think/respond) + flow-tools/task + state/topology/default-flow/compaction + flows/(注册表+scaffold 生成薄封装) + topologies/(app 层拓扑,如 dev-agent stateful-custom)
  surfaces/      ACP/CLI 适配器(保护):acp/ cli/ + stateful-flow/map-stream-chunk/...
  index.ts       入口 + 组合根(createFlowRuntime + materializeFlow 桥接 stateful-recipe)
examples/        参考实现(只读;dedup 后 graph/nodes 多为 re-export shim 指向 libs/topologies)
config/ prompts/ skills/ scripts/ docs/ tests/
```

分层(只能 import 左侧):**`core → runtime → libs → app → surfaces → index.ts`**(`libs` 内 nodes/tools/deepagents-acp/mcp 互不引用;`topologies/` 单向依赖 nodes/+mcp/,其余子目录不反向引 topologies/)。`tests/layering.test.ts` 强制(layerOf 粒度到 libs top-level),**零例外**。

## 建 flow(★ 开箱即用)

**重用单位 = `src/libs/nodes/` 节点 factory**(泛型于 State + `prompt(state)`/`write(result,state)` 回调),不是手写节点体。详见 **[docs/node-kit.md](docs/node-kit.md)**:

`createLlmNode`(一次调 LLM,文本/结构化 `parse`)· `createLlmStreamNode`(流式)· `createToolExecNode`(执行 tool_calls + 三态事件)· `createHumanApprovalNode`(HITL interrupt,`route` 可 Command 路由)· `createPrepareNode`(input→消息)· `createFanout`(Send 扇出)· `createSubgraphNode`(子图作节点)

> bespoke 节点**不强塞** factory(isApproval 短路、自定义 MCP 检索、反射 Command-goto 路由)——保留手写,见各 example 注释。

## examples(只读,先对照挑一个)

| 目录 | 场景 | Flow 类型 |
|---|---|---|
| [examples/rag](examples/rag/) | 检索增强 + 条件重试 | one-shot |
| [examples/travel-planner](examples/travel-planner/) | 并行(Send)+ HITL | stateful |
| [examples/project-manager](examples/project-manager/) | reflection 评估循环 + HITL | stateful |
| [examples/human-in-loop](examples/human-in-loop/) | interrupt 人审定稿 | stateful |
| [examples/dev-agent](examples/dev-agent/) | ReAct + subgraph + compact | stateful |
| [examples/deep-research](examples/deep-research/) | 长任务多阶段 + 持续会话 | stateful |

有状态统一用 `createStatefulFlow`([src/surfaces/stateful-flow.ts](src/surfaces/stateful-flow.ts))。**不要改 examples/,在 src/app/ 实现。**

## 规则

- **图是契约** — 连线/条件路由在 `graph.ts`;节点优先 factory、bespoke 才手写到 `nodes/`;决策逻辑抽纯函数 + 单测。
- **先 factory 后手写** — 节点先查 [node-kit.md](docs/node-kit.md);bespoke 保留并注释「为何不用 factory」。
- **保护区** — core/runtime/libs/surfaces 默认不改;`src/app/` 可改;examples/ 只读。
- **有状态用基座** — `createStatefulFlow`,不手写 run-loop。
- **工具顺序** — MCP → `libs/tools` 内置 → platform_api/agent_variable → 自写代码。
- **密钥** — env 或 agent_variable,禁止硬编码。
- **依赖只在本仓库** — 缺能力 `pnpm install` / 在 `src/runtime/` 扩展 / copy-in,不引仓库外路径。

两类 flow(`src/core/flow-types.ts`):`FlowExecutor`(one-shot)、`StatefulFlow`(HITL/跨重启)。

## 命令

```bash
pnpm install && pnpm build
pnpm flow "你好"               # 默认 flow(CLI;无凭证走 fallback 也能跑)
pnpm start:acp                # ACP 服务(供 Zed/JetBrains)
pnpm graph                    # 导出图拓扑(JSON / --mermaid)
pnpm exec tsx src/index.ts capabilities   # 能力分层查询(无凭证)
pnpm exec tsx src/index.ts sessions       # 已持久化会话
pnpm test && pnpm typecheck && pnpm typecheck:examples
pnpm smoke:acp                # ACP 冒烟(-- --dry-run 仅打印)
pnpm example:rag:cli "..."    # 跑范例(travel/pm/review/research/dev-agent 同理)
```

## 提交前检查

- [ ] 无硬编码密钥 · 无 `any` · import 带 `.js` 后缀
- [ ] 节点名不与 state channel 同名 · 决策函数(条件边路由)有单测
- [ ] 分层合规(`layering.test.ts` 绿)· runtime 自包含(无仓库外路径)

## 扩展阅读(需要时查)

- [docs/node-kit.md](docs/node-kit.md) — **factory catalog(建 flow 必读)**
- [docs/flow-patterns.md](docs/flow-patterns.md) — 进阶模式(Send/interrupt/Command/subgraph/checkpointer/长任务硬化)
- [docs/capabilities.md](docs/capabilities.md) · [docs/zed-debug.md](docs/zed-debug.md) · [README.md](README.md) · 各 `examples/*/README.md`
- **API 细节看源码**:`FlowRuntime`([src/runtime/flow-runtime.ts](src/runtime/flow-runtime.ts))、`FlowCallbacks`([src/core/flow-types.ts](src/core/flow-types.ts))、`createFlowRuntime`([src/index.ts](src/index.ts))、Surface Seam([src/surfaces/](src/surfaces/))、ACP hooks([src/libs/deepagents-acp/](src/libs/deepagents-acp/))、`createFlowTools`([src/app/flow-tools.ts](src/app/flow-tools.ts))
