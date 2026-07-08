# 平台工具登记与节点直接引用设计

> ⚠️ 已过时：本文基于“`spec.tools` 仅开发期记录、运行时不读”的旧方案。  
> 现行方案见：[`platform-tool-schema-driven-runtime.md`](./platform-tool-schema-driven-runtime.md)

## 目标

本文说明平台工具（Plugin / Workflow / Knowledge）从「开发期搜索登记」到「运行期节点调用」的完整链路，以及各层职责边界。

核心目标：

- 平台工具添加后，**不**表达成「每个工具一个图节点」，也**不**引入「能力位 / `bindTo`」分组层。
- 平台工具的 schema / targetType / targetId 在开发期静态进入 `spec.tools` 登记表（**开发期记录**），运行时**不再查询平台接口**、也**不**读取登记表。
- 图节点**直接**在自身 `params` 里声明要用的工具名；运行时按名从运行环境（MCP）注入的工具集（`allTools`）中取用。
- `dev-engineer-toolkit` 保持平台通用工具包，不与当前工作目录的图节点、flow spec、工具引用语义耦合。

## 职责边界

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| `dev-engineer-toolkit` | 搜索平台工具/技能；注册工具（`add-tool`）；读取平台配置摘要；保留平台返回的 `targetType` / `targetId` / `name` / `description` / `schema` 信息供开发期使用 | 不暴露 `nodeId`；不解释图节点；不生成 flow spec；不提供运行时工具查询 |
| `flow-builder` | 决定当前项目是否需要平台能力；调用 `dev-engineer-toolkit` 搜索和注册；把搜索结果中的 schema 静态写入 `spec.tools` 登记表；在**节点 `params`** 里写工具名（`platform-tool` 用 `toolName`，`tool-exec` 用 `tools`） | 不让运行时代码调用平台 dev 配置接口；不为已登记平台工具手写 fetch / `tool()` 包装 |
| `deepagents-flow-ts` scaffold | 解析 `spec.tools[]` 登记表（开发期记录，不进生成代码）；把节点 `params` 里的工具名渲染成 `pickTools(allTools, [...])` 或直接 `allTools` | 不在运行时查询平台配置；不理解平台搜索接口 |
| runtime graph | 从 `FlowRuntime.allTools` 中按工具名选择并执行 | 不读取 `4sandbox/agent/dev` 接口；不持有真实密钥值；不读 `spec.tools` 登记表 |

## 数据流

### 1. 开发期搜索与注册

开发 Agent 使用 `dev-engineer-toolkit`：

```bash
./scripts/search-apis.sh --kw "联网搜索"
./scripts/add-tool.sh --target-type "Plugin" --target-id 309
./scripts/get-config.sh --key tools
```

说明：

- `search-apis.sh` 的搜索结果是工具 schema 的来源。
- `add-tool.sh` 只负责让平台启用该工具。
- `get-config.sh --key tools` 只用于确认工具已注册。

### 2. 开发期登记（spec.tools）

`flow-builder` 从搜索结果中取工具配置，写入当前项目的 `spec.tools` 登记表（**开发期记录，运行时不读**）：

```jsonc
{
  "tools": [
    {
      "targetType": "Plugin",
      "targetId": 309,
      "name": "联网搜索",
      "description": "在互联网上搜索相关信息",
      "schema": "{...平台搜索结果返回的 schema 原文...}",
      "toolNames": ["web_search"]
    }
  ]
}
```

约束：

- `spec.tools` 是开发期登记记录（供理解参数、inspector 可视化、`project.md` 对照）；**运行时不读**，不序列化进生成代码。
- `toolNames` 记录该平台工具对应的运行时工具名；节点 `params` 引用此名字。
- schema 中的 `${...}` 占位符保持原样，不能替换为真实 URL、密钥或鉴权值。

### 3. 节点直接引用工具（生成代码）

固定管道要让某个节点用平台工具时，在**节点 `params`** 里写工具名。scaffold 渲染成运行时按名取工具：

- **`platform-tool`**（单工具主动调用）：`params.toolName`（必填）→ 生成 `tools: allTools, toolName: "<名>"`，节点从全量工具集按名定位。
- **`tool-exec`**（执行模型 `tool_calls` 的工具集合）：`params.tools: ["名"]` → 生成 `tools: pickTools(allTools, ["名"])`；缺省 `tools` 时取全部。
- **默认 ReAct**（`react-tools` / `dev-agent`）：think 节点绑定 `runtime.allTools` 全量，零配置可用。

`pickTools` 实现（`src/app/tool-bindings.ts`）：`names` 为空返回全部（向后兼容），否则按名过滤。

## 节点类型

### `platform-tool`

用于固定管道中的主动工具调用。节点从 state 构造参数，按 `params.toolName` 从运行时工具集定位并调用。

```jsonc
{
  "type": "platform-tool",
  "params": {
    "toolName": "web_search",
    "args": "(s) => ({ query: s.query, freshness: 'noLimit' })",
    "write": "(r) => ({ searchResult: r.raw })"
  }
}
```

适用场景：

- 独立联网搜索节点
- 价格查询节点
- 天气 / 股票 / 业务 API 查询节点
- 固定管道中必须执行某个外部能力的一步

### `tool-exec`

用于执行上一条 `AIMessage.tool_calls`，适合 ReAct 或模型先决定工具调用的场景。用 `params.tools: ["工具名"]` 限定可调用工具集合（缺省 = 全部）。

不适合直接表示「固定管道主动搜索一步」（那用 `platform-tool`）。

## 鉴权与 URL

已登记平台工具的真实 URL、SK、鉴权值不写入 flow 代码。

允许静态记录（在 `spec.tools` 登记表，开发期用）：

- `targetType` / `targetId`
- `name` / `description`
- `schema`
- `toolNames`
- `auth.env` 这类 env key 名

不允许静态记录：

- 真实密钥值
- 开发期平台内部接口调用逻辑
- 通过猜测写死的 Plugin execute URL / envelope

## 对照需求

| 需求 | 当前处理 |
| --- | --- |
| 统一大模型节点拿全部工具导致不可控 | 默认 ReAct 拿全部；固定管道由节点 `params.tools` 显式限定集合 |
| 平台添加工具后不生成每个工具一个图节点 | 工具只进 `spec.tools` 登记表；图节点按工具名引用，不为一工具建一节点 |
| 可能存在单独指定的工具节点 | `custom` 支持 `platform-tool`（单工具）和 `tool-exec`（工具集合） |
| 工具信息与鉴权已有 toolkit 描述 | `dev-engineer-toolkit` 保持搜索/注册/配置摘要职责，不新增运行时 env JSON |
| 工具 schema 开发期取出并静态进 spec | 从 `search-apis.sh` 结果写入 `spec.tools` 登记表（运行时不读） |
| 运行时不动态查询平台接口 | runtime 只消费 `FlowRuntime.allTools`，按节点声明的工具名取用 |
| toolkit 不直接与当前项目图实现耦合 | toolkit 不暴露 `nodeId` / flow spec / 工具引用语义 |

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `packages/dev-agent-flow/skills/dev-engineer-toolkit/` | 平台搜索、注册、配置摘要 |
| `packages/dev-agent-flow/skills/flow-builder/references/part3-tools-config.md` | 平台能力登记与节点工具引用流程 |
| `packages/deepagents-flow-ts/scripts/scaffold/schema.mjs` | `spec.tools[]` 登记表 schema（开发期记录） |
| `packages/deepagents-flow-ts/src/app/tool-bindings.ts` | `pickTools(allTools, names[])`：按工具名取子集 |
| `packages/deepagents-flow-ts/src/libs/nodes/platform-tool.ts` | 固定管道主动工具调用节点（按 `toolName` 定位） |
| `packages/deepagents-flow-ts/scripts/scaffold/blueprints/custom.mjs` | 生成 `platform-tool` / `tool-exec` 节点（渲染 `pickTools` / `allTools`） |

## 验证点

- `dev-engineer-toolkit` 中不出现 `nodeId` / `--json` / flow spec 语义。
- `flow-builder` 中平台登记步骤只调用 `add-tool.sh`；工具引用只写在节点 `params`。
- `deepagents-flow-ts` 中节点按 `params.toolName` / `params.tools` 渲染成 `allTools` + `toolName` 或 `pickTools(allTools, [...])`。
- `platform-tool` 生成代码包含 `createPlatformToolActionNode`、`tools: allTools`、`toolName: "<名>"`。
- `tool-exec` 生成代码包含 `createToolExecNode` + `pickTools(allTools, [...])`。
- `spec.tools` 登记表不进生成代码（运行时不读）。
