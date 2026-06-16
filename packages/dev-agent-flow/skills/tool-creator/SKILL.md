---
name: tool-creator
description: "deepagents-flow-ts 工具开发：tool() 函数、Zod schema 设计、无状态 vs 平台绑定工厂、注册到 createFlowTools"
tags: [tools, typescript, zod, langchain, structured-tool, flow]
version: "3.0.0"
---

# 工具创建器（Flow 版）

## When to Use
需要为 flow-ts 模板添加新的自定义工具时使用。flow-ts 的默认图 think 节点用 `bindTools` 绑定工具集；工具也可在自定义图的节点里调用。

## 前置检查（必须）
1. 查询平台插件：`platform_api(operation: "query_plugins", params: { query: "<所需能力>" })`
2. 检查现有工具：读取 `src/app/tools/index.ts` 看 `createFlowTools()` 返回了哪些
3. 确认 FlowRuntime 内置工具是否已覆盖：`bash` / `fs`(read/write/edit) / `search`(grep/glob) / `demo`(echo/calculate/time) / `http_request` / `json_utils` / `platform_api` / `agent_variable` / `mcp_tool_bridge`
4. 确认 native MCP 工具是否已覆盖（`ctx.mcpTools`）
5. 都没有才创建自定义工具

## 创建步骤

### Step 1: 创建工具文件 `src/app/tools/{name}.tool.ts`

**简单工具（无平台依赖）：**
```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const weatherTool = tool(
  async ({ city, unit }) => {
    const apiKey = process.env.AGENT_VAR_WEATHER_API_KEY;
    if (!apiKey) return "错误：请填写 WEATHER_API_KEY 变量";
    const res = await fetch(`https://api.weather.com/v1/current?city=${city}&unit=${unit}&key=${apiKey}`);
    const data = await res.json() as { temp: number; description: string };
    return `${city}: ${data.temp}°${unit === "celsius" ? "C" : "F"}, ${data.description}`;
  },
  {
    name: "get_weather",
    description: "获取指定城市的当前天气信息",
    schema: z.object({
      city: z.string().describe("城市名称，如 Beijing 或 北京"),
      unit: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("温度单位"),
    }),
  }
);
```

**平台绑定工具（需访问 platformClient / variableManager / mcpServerConfigs）：**
```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { RuntimeContext } from "../../src/runtime/index.js";

export function createMyTool(ctx: RuntimeContext) {
  return tool(
    async ({ query }) => {
      const apiKey = await ctx.variableManager.get("MY_API_KEY");
      if (!apiKey) return "错误：请填写 MY_API_KEY";
      if (ctx.platformClient) {
        const result = await ctx.platformClient.executePlugin("my-plugin", { query });
        return JSON.stringify(result);
      }
      return `Query: ${query}`;
    },
    {
      name: "my_tool",
      description: "需要平台集成的工具",
      schema: z.object({ query: z.string().describe("查询内容") }),
    }
  );
}
```

## tool() 函数与 Zod Schema 参考

### tool() 函数
所有工具通过 @langchain/core/tools 的 tool() 函数创建：
```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const myTool = tool(
  async ({ query, limit }) => { return `Found ${limit} results for "${query}"`; },
  {
    name: "my_tool",           // snake_case，LLM 调用时使用
    description: "使用此工具当你需要...明确说明触发场景",
    schema: z.object({
      query: z.string().describe("要搜索的内容"),
      limit: z.number().default(10).describe("最大返回条数"),
    }),
  }
);
```

### Zod Schema 设计规范
```typescript
z.object({
  url: z.string().describe("目标 URL"),                    // 必填
  method: z.enum(["GET", "POST"]).default("GET"),          // 枚举 + 默认值
  headers: z.record(z.string()).optional().describe("请求头"), // 可选
  timeout: z.number().default(30000).describe("超时毫秒"), // 带默认值
  options: z.object({                                      // 嵌套对象
    retry: z.boolean().default(false),
  }).optional(),
  tags: z.array(z.string()).default([]).describe("标签"),  // 数组
})
```
- 每个字段必须加 .describe()（LLM 依赖描述正确填参）
- 合理默认值用 .default()，真正可选用 .optional()

### 无状态工具 vs 平台绑定工具
| 类型 | 场景 | 注册方式 |
|------|------|---------|
| 无状态 | 不需要平台 API / 运行时对象 | 直接 import + 加入数组 |
| 平台绑定 | 需要 RuntimeContext（platformClient/variableManager/mcpServerConfigs） | 工厂函数 createXxxTool(ctx) |

> flow-ts 用 RuntimeContext（不是 ToolContext），从 "../../src/runtime/index.js" import。

### Step 2: 注册到 createFlowTools()

编辑 `src/app/tools/index.ts`：
```typescript
import { weatherTool } from "./weather.tool.js";
import { createMyTool } from "./my-service.tool.js";

export function createFlowTools(ctx, opts): StructuredTool[] {
  return [
    // ... 现有工具（httpRequestTool / jsonUtilsTool / platform / variable）
    weatherTool,                    // 无状态：直接引用
    createMyTool(ctx),              // 平台绑定：工厂调用
    // ... flow 自补（bash/fs/search/demo/mcp-bridge）+ ctx.mcpTools
  ];
}
```

### Step 3: 处理外部依赖
1. 用 `agent_variable` 创建占位变量（`AGENT_VAR_XXX`）
2. 工具代码中 `process.env.AGENT_VAR_XXX` 读取
3. **禁止**硬编码密钥

### Step 4: 验证
```bash
pnpm build          # 编译
pnpm typecheck      # 类型检查
pnpm test           # 测试
```

## 工具在图中的使用

默认图的 think 节点自动 `bindTools(runtime.allTools)`，注册后即可被 LLM 调用。
自定义图的节点也可直接 `invoke` 工具：
```typescript
const result = await weatherTool.invoke({ city: "北京", unit: "celsius" });
```

## 命名规范

| 规则 | 示例 |
|------|------|
| 文件名 | `weather.tool.ts` |
| 工具名（schema name） | `"get_weather"`（snake_case） |
| 无状态导出 | `export const weatherTool` |
| 平台绑定导出 | `export function createWeatherTool(ctx)` |
| 导入路径带 `.js` 后缀 | `import { weatherTool } from "./weather.tool.js"` |

## Anti-patterns
- 不查询平台 / 不检查内置工具就写自定义工具
- 在工具代码中硬编码 API key
- 使用 `any` 类型
- 导入路径不带 `.js` 后缀
- 不给 Zod 字段加 `.describe()`
- ✅ 先查平台 + 内置工具，确认无方案再写
- ✅ 用 agent_variable 管理密钥
- ✅ 注册到 createFlowTools() 数组
