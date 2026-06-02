---
name: tool-creator
description: "在 src/app/tools/ 下创建新工具的完整流程：Zod schema → tool() → 注册"
tags: [tools, typescript, zod, development]
version: "1.0.0"
---

# 工具创建器

## When to Use
需要为场景 Agent 添加新的自定义工具时使用。

## 前置检查（必须）
在写任何代码之前：
1. 查询平台插件：`platform_api(operation: "query_plugins", params: { query: "<所需能力>" })`
2. 检查现有工具：读取 `src/app/tools/index.ts` 看 `createTools()` 返回了哪些工具
3. 确认没有现成方案后，才开始创建

## 创建步骤

### Step 1: 创建工具文件
文件路径：`src/app/tools/{name}.tool.ts`

参考模板 `src/app/tools/_example.tool.ts`：

**简单工具（无平台依赖）：**
```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const myTool = tool(
  async ({ param1, param2 }) => {
    // 工具逻辑
    return `Result: param1="${param1}", param2=${param2}`;
  },
  {
    name: "my_tool",
    description: "工具功能描述，要清楚说明何时使用",
    schema: z.object({
      param1: z.string().describe("参数说明"),
      param2: z.number().default(42).describe("带默认值的参数"),
    }),
  }
);
```

**平台绑定工具（需要访问 platformClient / variableManager / mcpManager）：**
```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ToolContext } from "./index.js";

export function createMyTool(ctx: ToolContext) {
  return tool(
    async ({ query }) => {
      // 通过 ctx 访问平台能力
      // ctx.platformClient — 平台 API
      // ctx.variableManager — 变量管理
      // ctx.mcpManager — MCP 服务器
      return `Result for: ${query}`;
    },
    {
      name: "my_tool",
      description: "需要平台集成的工具",
      schema: z.object({
        query: z.string().describe("查询内容"),
      }),
    }
  );
}
```
注意：平台绑定工具在 `src/app/tools/index.ts` 中以 `createMyTool(ctx)` 形式注册。

### Step 2: 定义 Zod Schema
- 所有输入参数必须有 `.describe()` 说明
- 有默认值的参数用 `.default(value)`
- 真正可选的参数用 `.optional()`
- 枚举值用 `z.enum()`
- 嵌套对象用 `z.object()`
- 数组用 `z.array()`

### Step 3: 注册到工具工厂
编辑 `src/app/tools/index.ts`：

```typescript
import { myTool } from "./my-tool.tool.js";

export function createTools(ctx: ToolContext): StructuredTool[] {
  return [
    // ... 现有工具
    myTool,
  ];
}
```

### Step 4: 处理外部依赖
如果工具需要 API key 或外部凭据：
1. 使用 `agent_variable` 创建占位变量
2. 在工具代码中通过 `process.env.AGENT_VAR_XXX` 获取
3. **禁止**在代码中硬编码任何密钥

### Step 5: 验证
1. `npm run build` — 确认编译通过
2. `npm run typecheck` — 确认类型正确
3. 检查没有 `any` 类型
4. 检查所有导入路径带 `.js` 后缀

## 常见工具模式

### HTTP API 调用工具
```typescript
// 使用 http_request 工具，不自己写 fetch
// 或者创建专用工具包装 http_request
```

### 数据处理工具
```typescript
// 使用 json_utils 工具处理 JSON
// 或者创建专用工具使用 JSON.parse/stringify + Zod 验证
```

### 平台集成工具
```typescript
// 使用 platform_api 的 execute_plugin 操作
// 不要直接调用平台 HTTP API
```

## Anti-patterns
- ❌ 不查询平台就写自定义工具
- ❌ 在工具代码中硬编码 API key
- ❌ 使用 `any` 类型
- ❌ 导入路径不带 `.js` 后缀
- ❌ 不给 Zod schema 字段加 `.describe()`
- ✅ 先查平台，确认无方案再写
- ✅ 用 agent_variable 管理密钥
- ✅ 参考 _example.tool.ts 的结构
