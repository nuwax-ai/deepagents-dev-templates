# Part 3：工具 / MCP / 变量

> 所属：`flow-builder` L2-C。入口路由见 [SKILL.md](../SKILL.md)。平台工具接入 → `agent-dev-config` skill。

需要添加自定义工具、配置 MCP、管理 API key / 变量时读本层。

## 工具优先级（强制）

```
1. 平台 Plugin / Workflow / Knowledge  ← agent-dev-config 搜索并添加
2. 内置 libs/tools（bash/fs/search/http/json/platform_api/agent_variable/mcp_tool_bridge）
3. native MCP（runtime 自动合并）
4. 自写 src/libs/tools/ + 注册 createFlowTools()
```

## 创建工具 `src/libs/tools/{name}.tool.ts`

**无状态：**
```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const weatherTool = tool(
  async ({ city }) => {
    const apiKey = process.env.AGENT_VAR_WEATHER_API_KEY;
    if (!apiKey) return "错误：请填写 WEATHER_API_KEY";
    // ...
    return `${city}: …`;
  },
  {
    name: "get_weather",
    description: "获取城市天气",
    schema: z.object({ city: z.string().describe("城市名称") }),
  }
);
```

**平台绑定（工厂）：**
```typescript
export function createMyTool(ctx: RuntimeContext) {
  return tool(async ({ query }) => { /* ctx.variableManager / platformClient */ }, { ... });
}
```

### Zod 规范

- 每字段 `.describe()`；`tool()` 返回 string（复杂对象 `JSON.stringify`）
- 类型：`string`→`z.string()`、`number`→`z.number()`、`boolean`→`z.boolean()`

### 注册

`src/libs/tools/index.ts` re-export → `src/app/flow-tools.ts` 的 `buildTools()` 数组。think 自动 `bindTools`。

---

## MCP 配置

默认：`config/mcp.default.json`

**Stdio：**
```json
{
  "my-server": {
    "command": "pnpm",
    "args": ["dlx", "my-mcp-package"],
    "env": { "API_KEY": "${AGENT_VAR_MY_API_KEY}" }
  }
}
```

**合并策略**（`flow-agent.config.json`）：

| 策略 | 行为 |
|------|------|
| `session-wins` | ACP session 覆盖（默认） |
| `platform-wins` | 平台覆盖 session |
| `defaults-wins` | 本地 default 优先 |

调试：`pnpm exec tsx src/index.ts capabilities` · `mcp_tool_bridge list_servers`

---

## agent_variable

- 禁止硬编码密钥；`UPPER_SNAKE_CASE`；AI 创建占位用户填值
- 读取：`ctx.variableManager.get()` 或 `process.env.AGENT_VAR_XXX`
- MCP env：`"${AGENT_VAR_XXX}"`

---

## Anti-patterns

- ❌ 不查平台/内置/MCP 就自写工具
- ❌ 硬编码 API key / 忘记注册 createFlowTools()
- ❌ Zod 无 `.describe()` / 返回非 string
- ✅ 平台优先 → 内置 → MCP → 自写
