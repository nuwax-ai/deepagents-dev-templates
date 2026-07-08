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

凡 Agent 需**工作区以外**的能力（Plugin / Workflow / Knowledge / 平台技能 / 外部 API / 业务数据 / 联网检索等），**写 spec、`graph.ts`、`flow-tools.ts` 或 `*.tool.ts` 之前必须**到平台查找并登记。当前项目内置工具不能替代业务 API。

### 自动触发

- 用户要：调 API、接第三方、用知识库、平台技能、发通知、存取业务数据、或联网搜索
- 代码信号：新增 `tool()`、改 `flow-tools.ts`、新增 `tool-exec`、使用平台工具、需要外部数据
- Topology：`react-tools`、`dev-agent`、`rag`、`adaptive-rag`、`travel-planner`、`deep-research`、custom 含 `tool-exec`

**豁免**：纯 LLM 对话；仅工作区内 `grep` / `glob` / `read_file`。

### 工作流（必须 · 写代码前）

1. 加载 `dev-engineer-toolkit`
2. `search-apis.sh --kw "<能力关键词>"`（按需求拆词，可多轮）
3. 需领域技能 → `search-skills.sh --kw "<关键词>"`
4. `get-config.sh --key tools` / `skills`（按需）
5. 命中 → `add-tool.sh --target-type <type> --target-id <id>`
6. 记入 `project.md`（targetId、工具名、验证方式；固定管道在节点 `params` 写工具名）
7. 平台**确无**命中 → 记录搜索输出 → **然后**方可走优先级 3 自写 app 工具

### 工具登记与节点引用

平台登记只负责启用工具。`spec.tools` 是**开发期登记记录**（`targetType` / `targetId` / `name` / `schema` / `toolNames`），运行时不读——平台工具由运行环境（MCP）注入 `allTools`，节点直接按工具名引用。

固定管道要让某个节点用平台工具时，在**节点 `params`** 里写工具名，不再使用 `tools[].bindTo` 能力位：

```jsonc
{
  "tools": [
    {
      "targetType": "Plugin",
      "targetId": 614,
      "name": "token价格查询",
      "schema": "{...平台返回的接口 schema 原文...}",
      "toolNames": ["query_token_price"]
    }
  ]
}
```

- `toolNames` 记录该平台工具对应的运行时工具名；节点 `params` 引用此名字。
- `platform-tool` 节点用 `params.toolName`（单工具，必填）；`tool-exec` 节点用 `params.tools: ["工具名"]`（工具集合，缺省=全部）。
- 从 `search-apis.sh` 搜索结果取 `targetType` / `targetId` / `name` / `description` / `schema` 静态写入 `spec.tools`；`get-config.sh --key tools` 只用于确认工具已登记，运行期不再查平台接口。
- schema 中的 `${...}` 占位符必须保持原样；禁止硬编码 URL、密钥或鉴权值。

### 固定管道主动工具节点

需要“独立联网搜索节点 / 业务 API 节点”时，优先使用 custom DSL 的 `platform-tool`，不要把它写成 `tool-exec`：

```jsonc
{
  "tools": [
    {
      "targetType": "Plugin",
      "targetId": 309,
      "name": "联网搜索",
      "description": "在互联网上搜索相关信息",
      "schema": "{...平台返回的接口 schema 原文...}",
      "toolNames": ["web_search"]
    }
  ],
  "params": {
    "nodes": {
      "web_search": {
        "type": "platform-tool",
        "params": {
          "toolName": "web_search",
          "args": "(s) => ({ query: s.query, freshness: 'noLimit' })",
          "write": "(r) => ({ searchResult: r.raw })"
        }
      }
    }
  }
}
```

- `platform-tool`：节点主动从 state 构造参数，按 `params.toolName`（必填）从运行时工具集定位并调用，适合固定管道。
- `tool-exec`：只执行上一条 `AIMessage.tool_calls`，适合 ReAct/tool-calling 回路；用 `params.tools: ["工具名"]` 限定可调用工具集合（缺省=全部）。
- URL / 鉴权值不写入业务代码；schema 与 env key 可静态记录，真实密钥由运行环境注入。

### 完成闸门

| 场景 | 可否报「完成」 |
|------|----------------|
| 已执行平台搜索 + `get-config`，确无对应能力，已记录关键词与输出 | ✅ 可自写 app 工具或图内降级 |
| 平台有命中，已 `add-tool`，固定管道需要时已在节点 `params` 指定工具名 | ✅ |
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
3. 命中 → `add-tool.sh`；固定管道需要时在节点 `params` 写 `toolName` / `tools`
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
