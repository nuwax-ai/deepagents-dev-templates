# Part 3：工具 / MCP / 密钥

> 所属：`flow-builder` L2-C。入口路由见 [SKILL.md](../SKILL.md)。平台侧工具**登记**走 `dev-engineer-toolkit`（平台在线配置：tools / skills / mcpConfigs / systemPrompt，读写见该技能）；业务自定义 `tool()` **代码实现**在目标项目 `src/app/`。

需要添加自定义工具、配置 MCP、管理 API key 时读本层。

## 工具优先级（强制）

```
1. 平台 Plugin / Workflow / Knowledge  ← dev-engineer-toolkit 搜索并 add-tool；在 src/app/ 按返回 schema 手写 tool() 包装 → flow-tools.ts 注册
2. Native MCP                        ← config/mcp.default.json + ACP session mcpServers（与平台 mcpConfigs 合并）
3. 内置 libs/tools                   ← bash/fs/search/http/json/load_skill/task/demo（模板内置，勿改 libs）
4. 自写 src/app/ + flow-tools.ts     ← 最后手段：在 app 层实现并注册 createFlowTools()
```

> 已无 `mcp_tool_bridge` 元工具；MCP 工具由 runtime 原生绑定，直接用 server 暴露的工具名调用。

## 创建自定义工具 `src/app/tools/{name}.tool.ts`

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

在 `src/app/flow-tools.ts` 的 `buildTools()` 数组 import 并加入；think 节点自动 `bindTools`。**禁止**改 `src/libs/tools/`（保护区）。

### 内置 `http_request` 安全默认

模板内置 `http_request` 默认拦截私有/loopback/链路本地/云元数据端点（防 SSRF），并限制响应体大小（防 OOM）。目标项目一般无需改；若业务必须访问内网，需开发者明确要求并理解风险后再调整（见目标项目 `docs/capabilities.md`）。

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

调试：`pnpm exec tsx src/index.ts capabilities`（列出 MCP server、内置工具、skills 分层）

---

## 密钥与环境变量

- 禁止硬编码密钥；工具内读 `process.env`；MCP server `env` 引用同名变量
- 运行时 **ACP session** 仅回注 `systemPrompt` 与 `mcpServers`（合并进 runtime）；平台 Plugin/Workflow/Knowledge **不经 ACP 下发**，须在 `src/app/` 实现包装器

---

## Anti-patterns

- ❌ 不查平台能力 / 内置 / MCP 就自写工具
- ❌ 硬编码 API key / 忘记注册 createFlowTools()
- ❌ 引用已删除的 `platform_api` / `agent_variable` / `mcp_tool_bridge`
- ❌ 在 `src/libs/tools/` 写业务自定义工具（保护区）
- ❌ Zod 无 `.describe()` / 返回非 string
- ✅ 平台能力优先（dev-engineer-toolkit）→ native MCP → 内置 → app 层自写
