# Part 3：工具 / MCP / 密钥

> 所属：`flow-builder` L2-C。入口路由见 [SKILL.md](../SKILL.md)。平台工具**注册**走 `dev-engineer-toolkit`；`tool()` **代码实现**在目标项目 `src/libs/tools/` + `src/app/flow-tools.ts`（见目标项目 `docs/node-kit.md`）。

需要添加自定义工具、配置 MCP、管理 API key 时读本层。

## 工具优先级（强制）

```
1. 平台 Plugin / Workflow / Knowledge  ← dev-engineer-toolkit 搜索并 add-tool（开发期）；运行时经 ACP 下发
2. 内置 libs/tools（bash/fs/search/http/json/mcp_tool_bridge）
3. native MCP（default + ACP session，runtime-context 自动合并）
4. 自写 src/libs/tools/ + 注册 createFlowTools()
```

## 创建工具 `src/libs/tools/{name}.tool.ts`

**无状态：**
```typescript
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const weatherTool = tool(
  async ({ city }) => {
    const apiKey = process.env.WEATHER_API_KEY;
    if (!apiKey) return "错误：请设置环境变量 WEATHER_API_KEY";
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

**需运行时上下文（工厂）：**
```typescript
export function createMyTool(ctx: RuntimeContext) {
  return tool(async ({ query }) => { /* 可读 ctx.mcpServerConfigs / ctx.config */ }, { ... });
}
```

### Zod 规范

- 每字段 `.describe()`；`tool()` 返回 string（复杂对象 `JSON.stringify`）
- 类型：`string`→`z.string()`、`number`→`z.number()`、`boolean`→`z.boolean()`

### 注册

`src/libs/tools/index.ts` re-export → `src/app/flow-tools.ts` 的 `buildTools()` 数组。think 自动 `bindTools`。

---

## MCP 配置

默认：`config/mcp.default.json`；ACP `session/new` 的 `mcpServers` 可覆盖（`session-wins`）。

**Stdio：**
```json
{
  "my-server": {
    "command": "pnpm",
    "args": ["dlx", "my-mcp-package"],
    "env": { "API_KEY": "${OPENAI_API_KEY}" }
  }
}
```

**合并策略**（`flow-agent.config.json`）：

| 策略 | 行为 |
|------|------|
| `session-wins` | ACP session 覆盖 default（默认） |
| `defaults-wins` | 本地 default 优先 |

调试：`pnpm exec tsx src/index.ts capabilities` · `mcp_tool_bridge list_servers`

---

## 密钥与环境变量

- 禁止硬编码密钥；工具内读 `process.env`；MCP server `env` 引用同名变量
- 平台保存的系统提示词 / MCP 经 **ACP session** 注入运行时，不经 `platform_api` 工具

---

## Anti-patterns

- ❌ 不查平台/内置/MCP 就自写工具
- ❌ 硬编码 API key / 忘记注册 createFlowTools()
- ❌ 引用已删除的 `platform_api` / `agent_variable` 运行时工具
- ❌ Zod 无 `.describe()` / 返回非 string
- ✅ 平台优先（dev 配置）→ 内置 → MCP → 自写
