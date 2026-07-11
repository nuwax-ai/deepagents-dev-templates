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

### 工具登记与节点引用

平台 `add-tool` 负责**登记/启用**工具；真实调试/运行时由平台宿主把已登记能力注入会话（ACP/MCP/session 配置），`deepagents-flow-ts` 再加载成 `runtime.allTools`（`StructuredTool[]`）。图内节点**从 `runtime.allTools` 按名引用**，无需在代码里手抄 schema：

- **默认 ReAct**：宿主注入后，`think.bindTools(runtime.allTools)` 会拿到平台工具，模型按需调用——聊天助手型只需登记 + systemPrompt 点名，**不写图**。
- **固定管道 / 自建图**：要让某节点用平台工具时，先用 `pickTools(runtime.allTools, ["真实工具名"])` 得到 `StructuredTool[]` 再传给 `createToolExecNode`；主动调用节点则从 `runtime.allTools` 按工具名定位后 direct-invoke。
- **调试确认**：若 `get-config` 能看到工具但运行未调用，先用 `flow-debugger --with-logs` 查本次会话是否实际注入该工具（SSE/runtime 工具名、MCP server、日志中的 `Loaded MCP tools`）。

> **示例免责**：下列 `targetId` / 工具名均为**结构占位**，非真实工具；真实值**必须**经 `search-apis.sh` → `add-tool.sh` → `get-config.sh --key tools --full` 获取，**禁止照抄本文数值 / 名称**。

- 运行时工具名：优先用 `get-config` 返回的 `toolName`，否则按 `${targetType}_${targetId}` 自动拼（如 `Plugin_<id>`）；节点里用这个名字定位工具。
- `get-config.sh --key tools --full` 返回的工具名 / schema 仅用于**确认真实名称并写进 `project.md`**（供收工 `--expect-tool` 断言），不再落盘成 flow spec。
- 禁止硬编码 URL、密钥或鉴权值；schema 里的 `${...}` 占位符由运行环境解析。

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

### 固定管道主动工具节点

需要"独立联网搜索节点 / 业务 API 节点"（固定管道里主动调用，而非等 ReAct 的 `tool_calls`）时，在自定义节点里从 `runtime.allTools` 按工具名定位后 direct-invoke（下例 `toolName` 为占位，真实值以 `get-config` 为准）：

```typescript
// src/app/graph.ts / src/app/nodes/：固定管道里主动调用平台工具
import type { StructuredTool } from "@langchain/core/tools";

function webSearchNode(allTools: StructuredTool[]) {
  const tool = allTools.find((t) => t.name === "Plugin_<id>"); // 占位：用 get-config 返回的真实工具名
  if (!tool) throw new Error("平台搜索工具未登记（先 add-tool）");
  return async (s: MyStateType): Promise<Partial<MyStateType>> => {
    const raw = await tool.invoke({ query: s.query, freshness: "noLimit" });
    return { searchResult: raw };
  };
}
```

需要让模型在某个 ReAct 子回路里按需发起 `tool_calls` 时，`createToolExecNode` 的 `tools` 参数必须是 `StructuredTool[]`，不要传字符串数组：

```typescript
import { pickTools } from "./tool-bindings.js";
import { createToolExecNode } from "../libs/nodes/index.js";

const selectedTools = pickTools(allTools, ["Plugin_<id>"]);
if (selectedTools.length === 0) {
  throw new Error("平台工具未注入本次会话：Plugin_<id>");
}
const toolsNode = createToolExecNode<MyStateType>({ tools: selectedTools });
```

- **主动调用**：固定管道节点自行从 state 构造参数、按工具名定位并 `invoke`，适合"每轮必搜"这类固定步骤。
- **`createToolExecNode`**：只执行上一条 `AIMessage.tool_calls`，适合 ReAct/tool-calling 回路；用 `pickTools(...)` 限定可调用工具集合（名字为空才表示全部，名字写错会得到空数组，必须显式报错）。
- **默认 ReAct**：宿主注入后，`think.bindTools(runtime.allTools)` 会拿到平台工具，无需手写调用。
- URL / 鉴权值不写入业务代码；真实密钥由运行环境注入。

### 完成闸门

| 场景 | 可否报「完成」 |
|------|----------------|
| 已执行平台搜索 + `get-config`，确无对应能力，已记录关键词与输出 | ✅ 可自写 app 工具或图内降级 |
| 平台有命中，已 `add-tool`，固定管道需要时节点已按真实工具名从 `runtime.allTools` 引用 | ✅ |
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
3. 命中 → `add-tool.sh`；固定管道需要时节点按真实工具名从 `runtime.allTools` 引用
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

- ❌ 为已登记平台能力手写 fetch / `tool()` 包装
- ❌ 不查平台能力就自写工具
- ❌ 联网搜索未走 `search-apis.sh` 就 bash+curl 或自写搜索 API
- ❌ 运行时代码调用 `4sandbox` 系平台内部端点（仅 dev-engineer-toolkit 脚本可用）
- ❌ 硬编码 API key / 忘记注册 createFlowTools()
- ❌ 在 `src/libs/tools/` 写业务自定义工具（保护区）
- ❌ Zod 无 `.describe()` / 返回非 string
- ✅ 平台能力优先 → 内置 → app 层自写；联网另见 § 联网搜索
