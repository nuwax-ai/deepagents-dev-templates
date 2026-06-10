---
name: langchain-core-tools
description: "LangChain 工具开发参考：tool() 函数、Zod schema 定义、StructuredTool、平台绑定工具工厂函数模式"
tags: [langchain, tools, zod, typescript, structured-tool]
version: "1.0.0"
---

# LangChain 工具开发参考

## When to Use

需要在 `src/app/tools/` 下创建新工具时使用——包括 `tool()` 函数用法、Zod schema 设计、工具注册模式，以及如何区分无状态工具和平台绑定工具。

---

## 核心：tool() 函数

所有工具通过 `@langchain/core/tools` 的 `tool()` 函数创建：

```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const myTool = tool(
  async ({ query, limit }) => {
    // 工具实现逻辑
    // 返回字符串（LLM 看到的结果）
    return `Found ${limit} results for "${query}"`;
  },
  {
    name: "my_tool",           // 工具名：snake_case，LLM 调用时使用
    description: `使用此工具当你需要...
    明确说明触发场景，帮助 LLM 决定是否调用。`,
    schema: z.object({
      query: z.string().describe("要搜索的内容"),
      limit: z.number().default(10).describe("最大返回条数"),
    }),
  }
);
```

---

## Zod Schema 设计规范

```typescript
z.object({
  // 必填字段
  url: z.string().describe("目标 URL"),

  // 枚举类型
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("GET"),

  // 可选字段
  headers: z.record(z.string()).optional().describe("请求头键值对"),

  // 带默认值的字段
  timeout: z.number().default(30000).describe("超时毫秒数"),

  // 嵌套对象
  options: z.object({
    retry: z.boolean().default(false),
    maxRetries: z.number().default(3),
  }).optional(),

  // 数组类型
  tags: z.array(z.string()).default([]).describe("标签列表"),
})
```

**规则**：
- 每个字段必须加 `.describe()` 说明——LLM 依赖这些描述来正确填参
- 有合理默认值的用 `.default()`，不要求必填
- 真正可选的用 `.optional()`（LLM 可以不传）

---

## 无状态工具（标准模式）

不需要访问平台 API 或运行时对象：

```typescript
// src/app/tools/weather.tool.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const weatherTool = tool(
  async ({ city, unit }) => {
    const apiKey = process.env.AGENT_VAR_WEATHER_API_KEY;
    if (!apiKey) return "错误：请在平台设置中填写 WEATHER_API_KEY 变量";

    const res = await fetch(`https://api.weather.com/v1/current?city=${city}&unit=${unit}&key=${apiKey}`);
    const data = await res.json() as { temp: number; description: string };
    return `${city}: ${data.temp}°${unit === "celsius" ? "C" : "F"}, ${data.description}`;
  },
  {
    name: "get_weather",
    description: "获取指定城市的当前天气信息",
    schema: z.object({
      city: z.string().describe("城市名称，如 'Beijing' 或 '北京'"),
      unit: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("温度单位"),
    }),
  }
);
```

注册到 `src/app/tools/index.ts`：

```typescript
import { weatherTool } from "./weather.tool.js";

export function createTools(ctx: ToolContext): StructuredTool[] {
  return [
    // ... 现有工具
    weatherTool,
  ];
}
```

---

## 平台绑定工具（工厂函数模式）

需要访问 `PlatformClient`、`VariableManager`、`MCPManager` 时：

```typescript
// src/app/tools/my-service.tool.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ToolContext } from "./index.js";

export function createMyServiceTool(ctx: ToolContext) {
  return tool(
    async ({ query }) => {
      // 通过 ctx 访问平台资源
      const apiKey = await ctx.variableManager.get("MY_SERVICE_API_KEY");
      if (!apiKey) return "错误：请填写 MY_SERVICE_API_KEY 变量";

      // 或使用 platformClient（仅平台模式下非 null）
      if (ctx.platformClient) {
        const result = await ctx.platformClient.executePlugin("my-plugin-id", { query });
        return JSON.stringify(result);
      }

      return `Query received: ${query}`;
    },
    {
      name: "my_service",
      description: "调用 My Service API 执行查询",
      schema: z.object({
        query: z.string().describe("查询内容"),
      }),
    }
  );
}
```

注册（工厂调用，传入 ctx）：

```typescript
import { createMyServiceTool } from "./my-service.tool.js";

export function createTools(ctx: ToolContext): StructuredTool[] {
  return [
    // ...
    createMyServiceTool(ctx),  // 注意：调用工厂函数
  ];
}
```

---

## 实际示例：http_request 工具（模板内置）

```typescript
// src/app/tools/http-request.tool.ts（简化版）
export const httpRequestTool = tool(
  async ({ url, method, headers, body, timeout }) => {
    const response = await fetch(url, { method, headers, body, signal });
    const responseBody = await response.text();
    return JSON.stringify({ status: response.status, body: responseBody });
  },
  {
    name: "http_request",
    description: "发起 HTTP 请求。使用前先检查平台插件是否已提供该能力。",
    schema: z.object({
      url: z.string().describe("目标 URL"),
      method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).default("GET"),
      headers: z.record(z.string()).optional().describe("请求头"),
      body: z.string().optional().describe("请求体（JSON 字符串）"),
      timeout: z.number().default(30000).describe("超时毫秒数"),
    }),
  }
);
```

---

## 工具文件命名规范

| 规则 | 示例 |
|------|------|
| 文件名：`{name}.tool.ts` | `weather.tool.ts` |
| 工具名（schema name）：`snake_case` | `"get_weather"` |
| 无状态导出：`const xyzTool` | `export const weatherTool` |
| 平台绑定导出：`function createXyzTool(ctx)` | `export function createWeatherTool(ctx)` |
| 导入路径带 `.js` 后缀 | `import { weatherTool } from "./weather.tool.js"` |

---

## 前置检查（写工具前必须执行）

```typescript
// 1. 先查询平台是否已有现成插件
platform_api(operation: "query_plugins", params: { query: "weather api" })

// 2. 检查现有工具：读取 src/app/tools/index.ts
// 3. 确认无现成方案后，再创建自定义工具
```

## Anti-patterns

- ❌ 在工具代码中硬编码 API key：`const key = "sk-xxx"`
- ❌ 忘记给 Zod 字段加 `.describe()`（LLM 会乱填参数）
- ❌ 工具函数签名不是 `async` 但执行了 I/O 操作
- ❌ 导入路径不带 `.js` 后缀（ESM 编译会报错）
- ❌ 不在 `createTools()` 中注册就以为工具可用
- ❌ 使用 `any` 类型（strict 模式会报错）
- ✅ API key 通过 `process.env.AGENT_VAR_XXX` 读取（由平台注入）
- ✅ 工具返回描述性错误字符串而不是抛出异常
- ✅ 写完工具后运行 `pnpm run build` 验证编译