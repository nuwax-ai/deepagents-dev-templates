---
name: flow-framework
description: "deepagents-flow-ts 分层架构 + 核心 API + ACP 集成：core/runtime/compose 分层、FlowRuntime、createFlowGraph nodes 工厂、surface seam、FlowCallbacks（含 onPlan）、bootstrapFlowAcp 短路、ACPSessionConfig"
tags: [framework, api, layering, flow-runtime, surface, acp, callbacks, topology, nodes]
version: "3.0.0"
---

# Flow 框架 API 与 ACP 集成

## When to Use
需要理解 flow-ts 分层架构、核心 API、或 ACP 协议集成时——FlowRuntime 注入、默认图 nodes 工厂、surface seam、回调机制、拓扑导出、bootstrapFlowAcp 短路、会话配置。

## 分层架构（重构后核心）

```
core (L1)  -> runtime (L2) -> app (L3) -> { surfaces | compose } (L4) -> index.ts
(纯契约)    (底层运行时)     (默认图)     (适配器 | 组合根)              (入口/装配)
```
import 只能向左（下行合法）；surfaces 与 compose 平级互不引用；跨层向下装配只在 compose/ 和 index.ts。
该规则由 `tests/layering.test.ts` 强制。

| 层 | 路径 | 职责 | 依赖方向 |
|----|------|------|----------|
| core | `src/core/` | 纯类型契约（FlowCallbacks/FlowExecutor/StatefulFlow/事件），零运行时依赖 | 无 |
| runtime | `src/runtime/` | 自包含底层运行时（config/context/fs/platform/services + barrel index） | 仅 core |
| app | `src/app/` | 默认 ReAct 图（graph.ts 连线 + nodes/ 节点 + tools/ 工具） | runtime |
| compose | `src/compose/` | 组合根：createFlowRuntime 装配 runtime + tools | app（唯一跨层向下） |
| surfaces | `src/surfaces/` | ACP/CLI 适配器 + stateful-flow 基座 | core（不依赖 app） |

> flow-ts **自包含**：不依赖 deepagents-app-ts，底层运行时全部在 `src/runtime/` 内。
> MCP 经 `@langchain/mcp-adapters` 由 runtime-context 内部自管，不单独导出 manager。

## FlowRuntime（能力注入中枢）

**接口**在 `src/runtime/flow-runtime.ts`（纯类型，仅引用 runtime 层类型）；
**装配工厂**在 `src/compose/flow-runtime.ts`（需 import app 层的 createFlowTools，故在 app 之上的 compose）。

```typescript
const runtime = await createFlowRuntime(appConfig);
// runtime（FlowRuntime 接口）包含：
//   config        — AppConfig
//   ctx           — RuntimeContext（mcpServerConfigs/mcpTools/platformClient/variableManager）
//   allTools      — 全部工具（内置通用 + flow 自补 + native MCP）-> think 节点 bindTools
//   systemPrompt  — 解析后提示词（ACP > config > prompts/ 文件 > fallback）
//   skillsPaths   — 已发现 skills 目录
//   subAgents     — 已发现声明式 subagent
//   sandbox       — FlowSandboxPolicy（bash/fs 执行前校验）
//   checkpointer  — FileCheckpointSaver（跨重启恢复 + interrupt/resume 持久化）
```
节点经 FlowRuntime 拿 allTools / checkpointer / systemPrompt，**不裸调 resolveModel**。
统一从 barrel 引入底层能力：`import { loadConfig, resolveModel, logger, ... } from "../runtime/index.js"`。

## 默认图 API（src/app/graph.ts + nodes/）

### createFlowGraph(config) — 只做「建节点 + 连边」
```typescript
const graph = createFlowGraph({
  allTools: runtime.allTools, checkpointer: runtime.checkpointer,
  config: runtime.config, systemPrompt: runtime.systemPrompt, callbacks,
});
```
默认图：`START -> prepare -> think <-> tools -> respond -> END`

### nodes 工厂模式（重构后拆分）
节点实现拆到 `src/app/nodes/`；graph.ts 只聚合连线。
- `prepareNode` — 纯函数（直接导出）
- `createThinkNode(deps)` — 工厂：解析一次模型 + bindTools，闭包持有 boundModel
- `createToolsNode(deps)` — 工厂：ToolNode 执行 + onToolCall 三态透出
- `createRespondNode(deps)` — 工厂：取回答经 onToken 流式输出

新增节点照此放一个文件 + 在 `nodes/index.ts` re-export，再到 graph.ts 连线。

## Surface Seam（接入骨架）

| 函数 | 位置 | 作用 |
|------|------|------|
| `bootstrapFlowAcp({ executor, appConfig })` | `src/surfaces/acp/server.ts` | ACP 服务（stdio） |
| `runFlowCli(flow, { query, interactive })` | `src/surfaces/cli/run.ts` | CLI 跑一次 |
| `createStatefulFlow(options)` | `src/surfaces/stateful-flow.ts` | 有状态 flow 基座 |

## ACP 集成：bootstrapFlowAcp（onPrompt 短路）

deepagents-acp 的 `onPrompt` 钩子在 agent 运行前触发，返回 `{ stopReason }` 即短路。
surface 在这里跑传入的 executor，把回答经 `conn` 流式推给客户端，**deep agent 永不进入请求路径**。
所以不需要 force-tool / 巨型提示词那套把 loop 逼成 workflow 的 hack。

```typescript
await bootstrapFlowAcp({ executor, appConfig, debug });
// executor: FlowExecutor（函数）或 StatefulFlow（对象）
```

### 自动分流（typeof executor）
| executor 类型 | 判断 | 行为 |
|--------------|------|------|
| `FlowExecutor`（function） | `typeof === "function"` | one-shot：`(query, cb) => FlowResult` |
| `StatefulFlow`（对象，有 run） | `typeof !== "function"` | HITL：`run({query|resume}, threadId, cb)` |
开发者不需要手动判断 flow 类型，surface 自动处理。

### HITL 续跑（一个会话一个主题）
首条 prompt -> 无 checkpoint -> 新任务（toInput 开题）；后续每条 -> 有 checkpoint -> resume 续跑同一项目。
`hasStarted` 从 checkpointer 推断（`checkpoint_id` 是否存在），跨进程/IDE 重启仍准。
仅当 flow 未实现 hasStarted 时，退回进程内存 Set（重启即丢，老式兜底）。

## FlowCallbacks（重构后新增 onPlan）

```typescript
interface FlowCallbacks {
  onToken?: (token: string) => void | Promise<void>;       // 流式 token
  onToolCall?: (e: ToolCallEvent) => void | Promise<void>; // 工具调用事件
  onStage?: (e: StageEvent) => void | Promise<void>;       // 长任务阶段进度
  onPlan?: (e: PlanEvent) => void | Promise<void>;         // 结构化 Plan
}
```
| 回调 | ACP sessionUpdate | 说明 |
|------|-------------------|------|
| onToken | `agent_message_chunk` | 模型文本增量（主回答区） |
| onStage | `agent_thought_chunk` | 阶段进度（thought 区，不污染主回答） |
| onPlan | `plan` | 结构化任务清单（PlanEntry[]，与 deepagents-acp 对齐） |
| onToolCall | `tool_call` / `tool_call_update` | 工具 in_progress / completed / failed |
> types 从 `core/flow-types.js` import（或兼容路径 `surfaces/flow-types.js`）。

## ACPSessionConfig（高优先级覆盖）
ACP 客户端（nuwaclaw/Zed）建立连接时传入会话级配置（环境变量 `ACP_SESSION_CONFIG_JSON`）：
```json
{
  "model": "anthropic:claude-opus-4-8", "systemPrompt": "...",
  "cwd": "/workspace/my-project", "agentId": "2843", "spaceId": "1136",
  "mcpServers": { ... }
}
```
配置优先级链（从低到高）：
```
defaults < user ~/.deepagents < project .deepagents < config/flow-agent.config.json
< 环境变量 < ACP_SESSION_CONFIG_JSON（最高）
```

## 平台身份配置
```bash
PLATFORM_AGENT_ID=2843
PLATFORM_SPACE_ID=1136
PLATFORM_API_TOKEN=your-token
```
未配置时 platform_api / agent_variable 返回 "not configured"（local-only 模式）。

## createFlowTools（src/app/tools/index.ts，全部 inline）
```typescript
export function createFlowTools(ctx, opts): StructuredTool[] {
  return [
    // 内置通用（本目录 inline，非 vendor）
    httpRequestTool, jsonUtilsTool,
    createPlatformApiTool(ctx.platformClient), createAgentVariableTool(ctx.variableManager),
    // flow 自补（本目录）
    createBashTool(opts), ...createFsTools(opts), ...createSearchTools(opts),
    ...createDemoTools(), createMcpBridgeTool(ctx.mcpServerConfigs),
    // native MCP（@langchain/mcp-adapters，runtime-context 自管）
    ...ctx.mcpTools,
  ];
}
```
新工具注册到这个数组（见 `tool-creator` 技能）。

## 拓扑导出（topology.ts）
```bash
pnpm graph              # -> { nodes, edges } JSON
pnpm graph --mermaid    # -> Mermaid 源
```

## 配置加载（loadFlowConfig，src/runtime/flow-config.ts）
```typescript
const { appConfig, raw, configPath } = loadFlowConfig({ configPath });
// raw 可取自定义配置段（如 RAG 的 raw.rag）
```

## ACP 调试
```bash
pnpm smoke:acp                    # 默认 flow 冒烟
pnpm smoke:dev-agent              # 指定示例入口
pnpm dlx rcoder-cli tui -c "node dist/bundle.mjs" -w .   # 交互式 TUI
pnpm dlx rcoder-cli chat -c "node dist/bundle.mjs" -w . -p "hello" -vv  # 详细日志
node dist/bundle.mjs              # 看启动报错（stderr）
```

## CLI 命令
| 命令 | 说明 |
|------|------|
| `pnpm flow "..."` | 跑默认 flow |
| `pnpm exec tsx src/index.ts flow -i` | 交互模式 |
| `pnpm start:acp` | ACP 服务 |
| `pnpm graph` | 导出图拓扑 |
| `pnpm exec tsx src/index.ts capabilities` | 能力查询（无凭证） |
| `pnpm exec tsx src/index.ts sessions` | 已持久化会话 |

## 常见错误排查
| 错误 | 原因 | 解决 |
|------|------|------|
| `model_provider is None` | `.env` 缺 API key | 填 ANTHROPIC_API_KEY / OPENAI_API_KEY |
| `Failed to start subprocess` | agent 启动崩溃 | 直接跑看原始报错 |
| 示例真调 LLM 报错无凭证 | 示例无 fallback | 配 `.env`（默认图有 fallback，示例没有） |
| `platform_api` 返回 not configured | 缺平台身份 | 设 PLATFORM_AGENT_ID / SPACE_ID |
| ACP timeout | 握手无响应 | 加 `-vv` 看日志 |

## Anti-patterns
- 节点裸调 resolveModel（应从 FlowRuntime 拿）
- 修改 core/runtime/surfaces/compose（保护区）
- 违反分层 import 方向（app import surfaces/compose）
- 绕过 bootstrapFlowAcp 自己写 ACP plumbing
- 手动判断 executor 类型（surface 自动分流）
- 在 index.ts 里直接调 graph.invoke 而不经 surface
- ✅ 节点经 FlowRuntime 拿能力
- ✅ graph.ts 只连线，节点实现拆 nodes/
- ✅ 从 runtime/index.js barrel 引入底层能力
- ✅ 图包成 executor 插 bootstrapFlowAcp
- ✅ HITL 流程交 createStatefulFlow + surface 自动续跑
