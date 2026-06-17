# Flow 工具开发对接指南（TypeScript / deepagents-flow-ts）

平台提供的工具**必须先搜索并添加到 Agent 配置**（见 `SKILL.md` 与 `api-docs.md`），之后才能在 flow-ts 中使用。本文说明第 3 步——**按平台返回的 `schema` 在 `src/libs/tools/` 中实现 TypeScript 工具，注册到 `src/app/flow-tools.ts` 的 `createFlowTools()`**。

> **写进代码的，只有"实际要用到的工具"本身。** 这里的 `tool()` 函数实现的是**该工具自己的业务逻辑**（你写的、运行时被智能体调用的代码），与 dev 配置接口（config/search/add/del/update）无关——dev 接口只在开发期手动跑，绝不 import 到工具代码里。

## 对接模型（flow-ts 版）

平台工具的 `schema` 字段是**字符串化的 JSON Schema**，描述了该工具的入参（字段名、类型、是否必填）。flow-ts 侧的核心任务：**用 `tool()` + Zod schema 定义工具入参与平台 schema 对齐**，注册到 `createFlowTools()`，由 think 节点自动 `bindTools`。

```
开发期（不进代码）：搜索 → 拿到 schema → tool/add 加进配置
                              │
                              ▼  schema 作为依据
运行时（写进代码）：src/libs/tools/xxx.tool.ts → tool() + Zod schema
                              │  注册到 src/app/flow-tools.ts 的 createFlowTools()
                              │  bindTools（think 节点自动）
                              ▼
                    LLM（按 schema 生成 tool call）──► tool() 执行业务逻辑
```

> flow-ts 里定义的工具必须与配置中添加的工具指向同一 `targetType`+`targetId`，这样模型生成的 tool call 才能被正确路由/对应。

## 第一步：解析平台 schema

先看清工具的入参定义：

```bash
echo '<搜索结果里的 schema 字符串>' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"
```

假设解析出的 schema 形如：

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "description": "搜索关键词" },
    "limit": { "type": "integer", "description": "返回条数", "default": 10 }
  },
  "required": ["query"]
}
```

## 第二步：用 tool() + Zod schema 对齐平台 schema

flow-ts 的通用工具放 `src/libs/tools/`，用 `@langchain/core/tools` 的 `tool()` 函数 + `zod` 定义入参。**字段名、类型、必填必须与平台 schema 一致**：

```typescript
// src/libs/tools/platform-search.tool.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// ① Zod schema：字段名/类型/必填对齐平台 schema 的 properties / required
const platformSearchSchema = z.object({
  query: z.string().describe("搜索关键词"),           // schema 中 required → 必填
  limit: z.number().optional().describe("返回条数"),   // schema 中非必填 → optional
});

// ② 用 tool() 包装，schema 作为入参定义
export const platformSearchTool = tool(
  async ({ query, limit }) => {
    // ⚠️ 这里写的是「这个工具自己的业务逻辑」——即运行时智能体调用它时真正执行的代码。
    //    不是去调 dev 配置接口（config/search/add 那些只用于开发期配置，不写进这里）。
    const results = await doSearch(query, limit ?? 10);
    return JSON.stringify(results);  // tool() 必须返回 string
  },
  {
    name: "platform_search",
    description: "按关键词在平台检索。",
    schema: platformSearchSchema,
  }
);
```

要点：

- **字段名严格对齐** `schema.properties`——LLM 按 schema 生成参数，名字不一致会调用失败。
- **类型对齐**：`string`→`z.string()`、`integer`→`z.number()`、`number`→`z.number()`、`boolean`→`z.boolean()`、`array`→`z.array()`、`object`→`z.record()` 或 `z.object()`。
- **必填对齐** `schema.required`：在 Zod schema 里这些字段不给 `.optional()`，其余字段加 `.optional()`。
- **description 对齐**：尽量复用 schema 里各字段的 description，提高模型调用准确率。
- **返回值必须为 string**：复杂对象用 `JSON.stringify()` 序列化。

## 第三步：注册到 createFlowTools()

在 `src/app/flow-tools.ts` 的 `createFlowTools()` 中注册新工具。先在 `src/libs/tools/index.ts` re-export，再在 flow-tools.ts 引入：

```typescript
// src/libs/tools/index.ts — 加一行 re-export
export { platformSearchTool } from "./platform-search.tool.js";

// src/app/flow-tools.ts — 在 buildTools 的返回数组中加入
import { platformSearchTool } from "../libs/tools/index.js";

export function createFlowTools(ctx, opts) {
  // ...
  const buildTools = (wsRoot: string): StructuredTool[] => [
    ...reused,
    platformSearchTool,  // ← 在此注册
    createBashTool({ workspaceRoot: wsRoot, policy }),
    // ...
  ];
  return tools;
}
```

注册后，`think` 节点会自动 `bindTools(allTools)` 到 LLM，无需手动绑定。

> **工厂模式**：如果工具需要运行时依赖（如 platformClient、variableManager），用工厂函数 `createXxxTool(deps)` 而非直接导出常量。照 `platform-api.tool.ts` / `agent-variable.tool.ts` 模式，在 `reused[]` 数组中用工厂调用注册。

## 系统提示词与开场白

系统提示词**保存到平台配置**（见 `SKILL.md` 第 5 步 / `api-docs.md` 第 2 节），flow-ts 运行时通过 `runtime-context` 中的 prompt 解析链统一读取（ACP session > config > `prompts/flow.base.md` > fallback），**不要在代码里硬编码重复一份**，避免与平台配置不一致。

## 与 flow-ts 内置工具的关系

flow-ts 默认图已内置一套工具（`createFlowTools()` 自动组装），**平台工具与内置工具共存**：

| 类别 | 来源 | 注册位置 |
|------|------|----------|
| 通用工具 | `http_request`、`json_utils` | `src/libs/tools/`（无状态，`reused[]`） |
| 平台工具 | `platform_api`、`agent_variable` | `src/libs/tools/`（工厂注入 platformClient，`reused[]`） |
| 沙箱工具 | `bash`、`fs`、`search`、`demo` | `src/libs/tools/`（按工作目录构建，`buildTools(wsRoot)`） |
| MCP 工具 | `@langchain/mcp-adapters` 加载 | `ctx.mcpTools`（runtime-context 自动合并） |
| **新增平台工具** | 本文档描述的 `tool()` + Zod | `src/libs/tools/` → `buildTools(wsRoot)` 中注册 |

> **新增工具不是替代内置工具**，而是补充。如果平台已有等价的内置工具（如 `http_request`），优先用内置的。

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| LLM 生成了 tool call 但平台报参数错误 | 工具字段名/类型与平台 schema 不一致 | 解析 schema，逐字段对齐 Zod 定义 |
| 模型从不调用该工具 | 工具未添加到配置 / description 不清晰 | 先 `tool/add` 进配置；完善 `tool()` 的 description |
| 必填字段缺失导致失败 | Zod schema 把必填字段也设了 `.optional()` | `schema.required` 中的字段不加 `.optional()` |
| 添加与实现的工具不匹配 | 加 A 调 B | 配置中 `targetId` 与 flow-ts 实现的工具指向同一项 |
| 工具没生效 | 忘了在 `createFlowTools()` 注册 | 在 `buildTools()` 数组中加入新工具 |
| 类型不兼容 | `tool()` 返回值不是 string | `tool()` 必须返回 string，复杂对象用 `JSON.stringify()` |

## Anti-patterns

- ❌ **在 `tool()` 函数体里调用 dev 配置接口**（config/search/add/del/update）——dev 接口是开发期手动跑的配置工具，不写进业务代码；`tool()` 里只写该工具自己的业务逻辑。
- ❌ 按 LLM 的"常识"给工具起字段名，不对照平台 schema。
- ❌ 把系统提示词同时硬编码在 flow-ts 代码里又存一份到平台——以平台配置为单一数据源。
- ❌ 没把工具 `tool/add` 进配置就直接用——平台不会路由。
- ❌ 忘了在 `createFlowTools()` 的 `buildTools()` 中注册新工具。
- ✅ 平台 schema → Zod schema → `tool()` → `createFlowTools()` 注册，一路对齐。
- ✅ **代码里只有"实际用到的工具"**；dev 接口留给开发期配置，两者分离。
- ✅ 参照 `platform-api.tool.ts` / `http-request.tool.ts` 的写法（`tool()` + Zod）。

## 参考版本

- `tool()`：`@langchain/core/tools`
- `z`：`zod`（Zod schema）
- `createFlowTools()`：`src/app/flow-tools.ts`
- 通用工具 barrel：`src/libs/tools/index.ts`
- `StructuredTool`：`@langchain/core/tools`
- 参照实现：`src/libs/tools/platform-api.tool.ts`（工厂模式）、`src/libs/tools/http-request.tool.ts`（无状态常量）
