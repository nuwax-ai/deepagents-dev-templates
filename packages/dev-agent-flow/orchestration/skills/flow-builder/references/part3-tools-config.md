# Part 3：工具 / 平台能力 / 密钥

> 所属：`flow-builder` L2-C。入口路由见 [SKILL.md](../SKILL.md)。
> 平台侧工具登记走 `dev-engineer-toolkit`；业务自定义 `tool()` 只作为平台确无命中后的兜底，代码落在当前项目 `src/app/`。

需要添加工具、接入平台能力、管理 API key 时读本层。

## 工具优先级（强制）

```
1. 平台能力（Plugin / Workflow / Knowledge / Skill） ← dev-engineer-toolkit 搜索并 add-tool
2. 内置 libs/tools                                  ← bash/fs/search（仅工作区 grep/glob）/http/json/load_skill/task/demo
3. 自写 src/app/ + flow-tools.ts                    ← 最后手段：仅「平台确无命中」的真外部 API
```

> **易错**：内置 `search` / `grep` = 当前工作目录内 ripgrep/glob，**不是**联网搜索。联网、文档检索、业务 API 等工作区外能力必须先平台搜索与登记。

## 平台能力登记（通用 · 强制）

凡 Agent 需**工作区以外**的能力（Plugin / Workflow / Knowledge / 平台技能 / 外部 API / 业务数据 / 联网检索等），**写 `graph.ts`、`flow-tools.ts` 或 `*.tool.ts` 之前必须**到平台查找并登记。当前项目内置工具不能替代业务 API。

### 自动触发

- 用户要：调 API、接第三方、用知识库、平台技能、发通知、存取业务数据、或联网搜索
- 代码信号：新增 `tool()`、改 `flow-tools.ts`、图内用 `createToolExecNode` / 主动调用平台工具的节点、需要外部数据
- 场景信号：默认 ReAct 需业务工具、检索增强问答、多源搜索聚合、深度研究等（照 `docs/examples.md` 自建时同样先登记）

**豁免**：纯 LLM 对话；仅工作区内 `grep` / `glob` / `read_file`。

### 工作流（必须 · 写代码前）

1. 加载 `dev-engineer-toolkit`
2. `search-apis.sh --kw "<能力关键词>"`（按需求拆词，可多轮）—— 仅用于发现 `targetType` / `targetId`
3. 需领域技能 → `search-skills.sh --kw "<关键词>"`
4. 命中 → `add-tool.sh --target-type <type> --target-id <id>`（只负责平台登记/启用）
5. `get-config.sh --key tools --full` 确认该工具**已注册的真实工具名与 schema**；**禁止**照 search 结果手抄
6. 记入 `project.md`（targetId、真实工具名、验证方式）
7. 平台**确无**命中 → 记录搜索输出 → **然后**方可走优先级 3 自写 app 工具

### 工具登记与图内接线

平台 `add-tool` 负责**登记/启用**；登记后工具进入运行时的方式有**两路来源**，图内用法有**三种接线**，不必全部塞进 `runtime.allTools`。

#### 来源（二选一或并用）

| 来源 | 做法 | 产物 |
|------|------|------|
| **宿主注入** | 平台会话 / ACP / MCP 下发已登记能力 | `StructuredTool` 进入 `runtime.allTools`（或等价注入集合） |
| **配置固化** | `get-config.sh --key tools --full` 拉真实 schema → 写入 `FlowDef.platformToolRefs`（或等价本地固化点）→ `createPlatformStructuredTool` | `StructuredTool`（由 runtime 按 schema 生成，**零包装代码**） |

- `get-config` 返回的 `toolName` / `targetType` / `targetId` / 完整 `schema` 可固化到 `platformToolRefs`；`project.md` 只记决策摘要（targetId、真实工具名、接线方式、验证方式）。
- **禁止**照 `search-apis.sh` 结果手抄半截 schema；**禁止**为已登记能力另写 fetch / `tool()` 包装（固化 schema ≠ 自写实现）。
- 禁止硬编码 URL、密钥或鉴权值；schema 里的 `${...}` 占位符由运行环境解析。

#### 用法（按图需要选一种或组合）

| 用法 | 适用场景 | 接线方式 |
|------|----------|----------|
| **独立节点** | 固定管道点名调某一个 Plugin（如「每轮必搜」） | `createPlatformToolActionNode({ tools, toolName, args, write })` 或节点内对 `StructuredTool` 直接 `invoke` |
| **局部工具集合** | 某段 ReAct / 子图只需部分平台工具 | `pickTools(tools, ["真实工具名"])` → `createToolExecNode({ tools: selected })`；或子图 `bindTools(selected)` |
| **并入 allTools（可选）** | 默认 ReAct、聊天助手型、模型按需选工具 | 宿主注入或 `platformToolRefs` 装配进 `runtime.allTools` → `think.bindTools(runtime.allTools)` |

- **默认 ReAct / 聊天助手型**：登记 + systemPrompt 点名即可，**不写图**；宿主注入或固化后并入 `allTools` 是便捷路径之一。
- **固定管道 / 自建图**：优先按节点或局部集合接线；不必为了「能用平台工具」强行把所有工具挂进 `allTools`。
- **调试确认**：若 `get-config` 能看到工具但运行未调用，先用 `flow-debugger` 查本次会话是否实际注入 / 固化工具（SSE/runtime 工具名、MCP server、日志中的 `Loaded MCP tools`）。

> **示例免责**：下列 `targetId` / 工具名均为**结构占位**，非真实工具；真实值**必须**经 `search-apis.sh` → `add-tool.sh` → `get-config.sh --key tools --full` 获取，**禁止照抄本文数值 / 名称**。

- 运行时工具名：优先用 `get-config` 返回的 `toolName`，否则按 `${targetType}_${targetId}` 自动拼（如 `Plugin_<id>`）；节点 / 集合里用这个名字定位工具。

### 三层工具名（生产易错 · `--expect-tool` 必读）

> 下表「形态示例」列仅示意**命名形态**（占位），非真实工具名；真实名以 `get-config --key tools --full` 返回为准。

| 层级 | 在哪出现 | 形态示例（占位） | 用途 |
|------|----------|------|------|
| **平台登记名** | `add-tool` / 提示词指引 | `<中文登记名>` | 提示词里告诉模型用哪个能力 |
| **SSE trace 名** | `componentExecuteResults[].name` | `platform__<tool>` | `debug.sh --expect-tool <tool>`（子串匹配） |
| **Runtime bindTools 名** | `bindTools` 后 / 图节点按名定位 | `platform__<tool>_<n>` | LLM 实际调用的工具名 |

**铁律**：
- `--expect-tool` 用 **runtime/SSE 英文子串**（如实际返回的 `<tool>` 片段或 `Plugin_<id>`），**禁止**用中文登记名
- `get-config --key tools --full` 后记录返回的 `toolName`，收工断言以 runtime 子串为准
- 提示词里可写中文登记名引导模型；flow-debugger 断言用 runtime 子串
- 若业务输出看似已调用工具但 `--expect-tool` 未命中，不算通过；用 flow-debugger `--show-trace` 或重新 `get-config --key tools --full` 确认 runtime/SSE 名称，修正断言后重跑同一主路径

### 固定管道与工具集合示例

**独立节点**（`createPlatformToolActionNode`）：从固化或注入得到的 `StructuredTool[]` 中点名调用。

```typescript
// src/app/graph.ts：固定管道里主动调用平台工具（toolName 占位，真实值以 get-config 为准）
import { createPlatformToolActionNode } from "../libs/nodes/index.js";
import type { StructuredTool } from "@langchain/core/tools";

// platformTools：来自 platformToolRefs 固化或 runtime.allTools / 宿主注入子集
function buildSearchNode(platformTools: StructuredTool[]) {
  return createPlatformToolActionNode<MyStateType>({
    tools: platformTools,
    toolName: "Plugin_<id>",
    args: (s) => ({ query: s.query, freshness: "noLimit" }),
    write: ({ raw }, _s) => ({ searchResult: raw }),
  });
}
```

**局部工具集合**（`createToolExecNode` + `pickTools`）：ReAct 子回路只暴露部分平台工具。

```typescript
import { pickTools } from "./tool-bindings.js";
import { createToolExecNode } from "../libs/nodes/index.js";
import type { StructuredTool } from "@langchain/core/tools";

// availableTools：固化产物、allTools 子集或宿主注入集合均可
function buildToolsNode(availableTools: StructuredTool[]) {
  const selectedTools = pickTools(availableTools, ["Plugin_<id>"]);
  if (selectedTools.length === 0) {
    throw new Error("平台工具未就绪：Plugin_<id>");
  }
  return createToolExecNode<MyStateType>({ tools: selectedTools });
}
```

- **独立节点**：节点自行从 state 构造参数并 `invoke`，适合固定步骤（每轮必搜等）。
- **`createToolExecNode`**：只执行上一条 `AIMessage.tool_calls`；用 `pickTools(...)` 限定局部集合（名字写错得空数组，须显式报错）。
- **默认 ReAct**：宿主注入或固化后并入 `allTools` → `bindTools`，模型按需调用；无需手写 HTTP。

### 完成闸门

| 场景 | 可否报「完成」 |
|------|----------------|
| 已执行平台搜索 + `get-config`，确无对应能力，已记录关键词与输出 | ✅ 可自写 app 工具或图内降级 |
| 平台有命中，已 `add-tool`，且已固化或可被节点/集合引用（独立节点 / 局部集合 / 可选 allTools） | ✅ |
| 未执行平台搜索就写外部能力 / 占位未接线 | ❌ 不得报完成 |
| 平台有命中但未 `add-tool` | ❌ 不得报完成 |
| 以「用户待配置」代替开发期登记 | ❌ 不得报完成 |

## 联网搜索（互联网 / 实时信息 · 常见专项）

联网搜索是平台能力登记中最常见的专项；下列步骤在通用登记之上追加。

### 自动触发

- 用户意图：搜索、联网、实时、网页、多源调研、资讯聚合
- 代码信号：要接入外部搜索、新闻、网页检索或实时数据源

### 工作流

1. 完成 § 平台能力登记 步骤 1–4
2. 追加关键词：`搜索` / `联网` / `web` / 业务领域词
3. 命中 → `add-tool.sh`；固定管道需要时按真实工具名接线（独立节点 / 局部集合 / 可选 allTools）
4. 记入 `project.md`

### 禁止

- ❌ 内置 `search` / `grep` 当联网
- ❌ 未搜平台就 bash+curl、自写搜索 API、`http_request` 打搜索站
- ❌ 未搜平台就写图或报完成
- ❌ 在 `src/libs/` 写业务搜索工具

## 创建自定义工具 `src/app/tools/{name}.tool.ts`

> **仅限**平台**确无**命中的真外部 API（工具优先级 3，须先贴平台搜索无命中证据）。已登记平台能力禁止走本节。

**无状态：**

```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const weatherTool = tool(
  async ({ city }) => {
    const apiKey = process.env.WEATHER_API_KEY;
    if (!apiKey) return "错误：请设置环境变量 WEATHER_API_KEY";
    return `${city}: ...`;
  },
  {
    name: "get_weather",
    description: "获取城市天气",
    schema: z.object({ city: z.string().describe("城市名称") }),
  }
);
```

### Zod 规范

- 每字段 `.describe()`；`tool()` 返回 string（复杂对象 `JSON.stringify`）
- 类型：`string`→`z.string()`、`number`→`z.number()`、`boolean`→`z.boolean()`

### 注册

在 `src/app/flow-tools.ts` 的 `buildTools()` 数组 import 并加入。**禁止**改 `src/libs/tools/`（保护区）。

## 工具权限审批（`permissions`）

副作用工具执行前可按配置请求用户确认。配置在**本地** `config/flow-agent.config.json`（workspace 配置，**非**平台在线配置）：

```jsonc
"permissions": {
  "mode": "ask",
  "interruptOn": ["write_file", "edit_file", "bash", "http_request"]
}
```

| 字段 | 说明 |
|------|------|
| `mode` | `yolo` = 全放行；`ask` = 仅 `interruptOn` 名单内工具弹窗 |
| `interruptOn` | 工具注册名列表（须与工具 `name` 一致） |

## 密钥与环境变量

- 禁止硬编码密钥；工具内读 `process.env`
- 平台脚本需要的认证、基址、空间/Agent 标识由 `dev-engineer-toolkit` 脚本内部读取；开发 Agent 不手写 HTTP，不直接暴露这些值
- schema 中的占位符保持原样，由运行环境解析

## Anti-patterns

- ❌ 为已登记平台能力手写 fetch / `tool()` 包装（固化 `platformToolRefs` schema 允许，自写 HTTP 禁止）
- ❌ 不查平台能力就自写工具
- ❌ 联网搜索未走 `search-apis.sh` 就 bash+curl 或自写搜索 API
- ❌ 运行时代码调用 `4sandbox` 系平台内部端点（仅 dev-engineer-toolkit 脚本可用）
- ❌ 硬编码 API key / 忘记注册 createFlowTools()
- ❌ 在 `src/libs/tools/` 写业务自定义工具（保护区）
- ❌ Zod 无 `.describe()` / 返回非 string
- ✅ 平台能力优先 → 内置 → app 层自写；联网另见 § 联网搜索
