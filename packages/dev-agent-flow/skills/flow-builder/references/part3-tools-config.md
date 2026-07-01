# Part 3：工具 / MCP / 密钥

> 所属：`flow-builder` L2-C。入口路由见 [SKILL.md](../SKILL.md)。平台侧工具**登记**走 `dev-engineer-toolkit`（平台在线配置：tools / skills / mcpConfigs / systemPrompt，读写见该技能）；业务自定义 `tool()` **代码实现**在目标项目 `src/app/`。

需要添加自定义工具、配置 MCP、管理 API key 时读本层。

## 工具优先级（强制）

```
1. 平台 Plugin / Workflow / Knowledge  ← dev-engineer-toolkit 搜索并 add-tool；在 src/app/ 按返回 schema 手写 tool() 包装 → flow-tools.ts 注册
2. Native MCP                        ← **平台 `mcpConfigs`**（get-config）+ config/mcp.default.json + ACP session mcpServers
3. 内置 libs/tools                   ← bash/fs/search（**仅工作区 grep/glob**）/http/json/load_skill/task/demo（模板内置，勿改 libs）
4. 自写 src/app/ + flow-tools.ts     ← 最后手段：在 app 层实现并注册 createFlowTools()
```

> **易错**：内置 `search` / `grep` = **仓库内** ripgrep/glob，**不是**联网搜索。

> 已无 `mcp_tool_bridge` 元工具；MCP 工具由 runtime 原生绑定，直接用 server 暴露的工具名调用。

## 平台能力登记（通用 · 强制）

凡 Agent 需**工作区以外**的能力（Plugin / Workflow / Knowledge / MCP / 平台技能 / 外部 API / 业务数据等），**写 spec、`graph.ts`、`flow-tools.ts` 或 `*.tool.ts` 之前必须**到平台查找并登记。模板内置工具（bash/fs/grep 等）**不能**替代业务 API。

> **常见场景**：**联网搜索**（网页检索、实时资讯、`mcp-retrieval`）出现频率最高，须走本节通用流程 + § 联网搜索 追加步骤；天气、通知、文件上传等业务 API 同理，按能力关键词 `search-apis`。

### 自动触发（满足任一即必读本节）

- 用户要：调 API、接第三方、用知识库、MCP、平台技能、发通知、存取业务数据、**或**联网搜索
- 代码信号：新增 `tool()` · 改 `flow-tools.ts` · `createToolExecNode` · `createMcpRetrievalNode` · `bindTools` · `mcpServers` / `searchMcp`
- Topology：`react-tools` · `dev-agent` · `rag` · `adaptive-rag` · `travel-planner` · `deep-research` · custom 含 `tool-exec` / `mcp-retrieval`

**豁免**：纯 LLM 对话；仅工作区内 `grep`/`glob`/`read_file`。

### 工作流（必须 · 写代码前）

1. 加载 `dev-engineer-toolkit`
2. `search-apis.sh --kw "<能力关键词>"`（按需求拆词，可多轮）
3. 需领域技能 → `search-skills.sh --kw "<关键词>"`
4. `get-config.sh --key tools` / `mcpConfigs` / `skills`（按需）
5. 命中 → `add-tool.sh` → `src/app/tools/` 包装（按 schema）→ `flow-tools.ts` 或图内 MCP 接线
6. 记入 `project.md`（targetId、工具名、MCP 名、验证方式）
7. 平台**确无**命中 → 记录搜索输出 → **然后**方可走优先级 4 自写 app 工具

### 优雅降级 vs 完成闸门

| 场景 | 可否报「完成」 |
|------|----------------|
| 已执行平台搜索 + `get-config`，**确无**对应能力，已记录关键词与输出 | ✅ 可自写 app 工具或图内降级 |
| 平台**有**命中，已 `add-tool` 并接线 | ✅ |
| **未执行**平台搜索就写外部能力 / 占位未接线 | ❌ **不得报完成**（即使 smoke 绿） |
| 平台有命中但未 `add-tool` / 未注册 `flow-tools.ts` | ❌ **不得报完成** |
| 以「用户待配置」代替开发期登记 | ❌ **不得报完成** |

> 优雅降级仅适用于「**已证明**平台无可用能力」；不是跳过本节的借口。

### 禁止

- ❌ 不查平台就自写 `*.tool.ts`、bash+curl、`http_request` 打外部 API
- ❌ 硬编码未在平台登记的 MCP / Plugin
- ❌ 在 `src/libs/tools/` 写业务工具（保护区）
- ❌ 把内置 `grep`/`search` 当业务 API 或联网

system-prompt 详版 → `<PLATFORM_CAPABILITIES>`

## 联网搜索（互联网 / 实时信息 · 常见专项）

> **说明**：联网搜索是 § 平台能力登记 中**最常见的专项**；下列规则在通用登记之上追加，不替代通用流程。

需求含**查互联网、最新资讯、实时数据、网页检索、多源调研**，或图/spec 使用 `mcp-retrieval` / `createMcpRetrievalNode` / `searchMcp` 时：先走上文 **§ 平台能力登记**，并追加搜索关键词与 `mcpConfigs` 检查。模板不提供开箱即用的联网搜索。

### 自动触发（满足任一即必读本节）

- 用户意图：搜索、联网、实时、网页、多源调研、资讯聚合
- Topology：`travel-planner` · `adaptive-rag` · `deep-research` · `search-aggregator` · 任意 custom 含 `type: "mcp-retrieval"`
- 代码信号：`createMcpRetrievalNode` · `createWebSearchNode` · `TravelSearchMcp` · `SEARCH_MCP`

**第一步（必做 · 写 spec/graph 之前）**：在 § 平台能力登记 基础上 → `search-apis.sh --kw "搜索"`（及 `联网` / `web`）→ `get-config.sh --key mcpConfigs` → 命中则 `add-tool.sh` 或同步 MCP。

### 选型表

| 优先级 | 来源 | 开发期 | 图内 |
|--------|------|--------|------|
| 1 | **平台 Plugin**（搜索 API） | `search-apis.sh --kw "搜索"` / `"联网"` / `"web"` → `add-tool.sh` → `src/app/` `tool()` → `flow-tools.ts` | ReAct / `createToolExecNode` |
| 2 | **平台 Knowledge** | 同上（领域知识库） | RAG / 检索工具 |
| 3 | **平台 `mcpConfigs`** | `get-config.sh --key mcpConfigs`；对齐 `config/mcp.default.json` | `createMcpRetrievalNode`（travel / custom `mcp-retrieval`） |
| 4 | **本地 MCP** | 仅平台无搜索 MCP 时，参考 `config/mcp.examples.json` | 同上 |
| 5 | **自写 app 工具** | 平台 + MCP 均无 | `flow-tools.ts` |

### Topology wiring

| Topology | 做法 |
|------|------|
| `travel-planner` / `deep-research` | `searchMcp` 接**平台登记**的搜索 MCP → `createMcpRetrievalNode` |
| `search-aggregator`（custom） | 同 travel-planner：`index.ts` 填 `SEARCH_MCP` → `createMcpRetrievalNode` |
| `adaptive-rag` | 路由 `web_search`；经平台 `searchMcp`（`createWebSearchNode`） |
| `multi-aspect-search`（custom） | `mcp-retrieval` 节点 + 平台搜索 MCP |
| `react-tools` / `dev-agent` | 平台业务 Plugin 注册为 tool → ReAct / `createToolExecNode` |
| **任意** custom / 手写 | spec 或 `graph.ts` 出现 `mcp-retrieval` / `searchMcp` → 同上行 |

### 优雅降级 vs 完成闸门（联网专项）

| 场景 | 图内行为 | 可否报「完成」 |
|------|----------|----------------|
| 已执行 § 平台能力登记 + 联网关键词搜索，平台**确无**搜索能力 | `searchMcp` 可缺省，research 写降级文案 | ✅ 须贴搜索无命中证据 |
| 平台**有**搜索 MCP/API，已 `add-tool` 并填入 `searchMcp` / `flow-tools.ts` | 正常检索 | ✅ |
| **未执行**平台搜索就写联网图 | smoke 可能靠模型知识通过 | ❌ 见 § 平台能力登记 |

### 工作流（联网 · 在通用登记之上）

1. 完成 § 平台能力登记 步骤 1–4
2. `search-apis.sh --kw "<关键词> 搜索"`（及 `联网` / `web`）
3. `get-config.sh --key mcpConfigs`
4. 命中 → `add-tool.sh` 或同步 MCP → 图内接线（`searchMcp` 等）
5. 记入 `project.md`

### 禁止

- ❌ 内置 `search`/`grep` 当联网
- ❌ 未搜平台就 bash+curl、自写搜索 API、`http_request` 打搜索站
- ❌ 未搜平台就写图或报完成（需平台能力的 flow；联网较常见）
- ❌ 硬编码未在平台登记的第三方搜索 MCP（用平台源）
- ❌ 在 `src/libs/` 写搜索（保护区）

system-prompt 详版 → `<WEB_SEARCH>`

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

模板内置 `http_request` 默认拦截私有/loopback/链路本地/云元数据端点（防 SSRF），并限制响应体大小（防 OOM）。目标项目一般无需改；若业务必须访问内网，需开发者明确要求并理解风险后再调整（见目标项目 `docs/capabilities.md` § 内置工具）。

> **与目标项目 `docs/capabilities.md` 的分工**：该文档描述**仓库内**能力分层与 `config/` 扩展路径；**平台 Plugin/Workflow/Knowledge 登记**与 **禁止 `.agents/` 直写** 由本 Part + `dev-engineer-toolkit` 规定（开发 Agent 必读）。

### 工具权限审批（`permissions`）

ACP 下副作用工具执行前可弹 `session/request_permission`。配置在**本地** `config/flow-agent.config.json`（workspace 配置，**非** `<PLATFORM_CONFIG>`）：

```jsonc
"permissions": {
  "mode": "ask",   // ask | yolo | plan（plan 本期等同 ask）
  "interruptOn": ["write_file", "edit_file", "bash", "http_request"]
}
```

| 字段 | 说明 |
|------|------|
| `mode` | `yolo` = 全放行；`ask` = 仅 `interruptOn` 名单内工具弹窗 |
| `interruptOn` | 工具**注册名**列表（须与 `flow-tools.ts` 中 `name` 一致，如 `bash` 而非 `execute`） |

- 门控在保护区 `createToolExecNode` 内自动生效，**开发者无需手写**审批节点。
- 用户拒绝 → 合成 `Permission denied` ToolMessage 喂回 LLM，turn 不中止。
- CLI / 不支持 `requestPermission` 的 client → graceful 放行；本地调试可设 `mode:"yolo"`。
- 图内秒级确认（非工具门控）→ `createPermissionApprovalNode`（见 part2 HITL 选型）。

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
- ❌ **联网搜索**：未 `search-apis.sh` / 未查 `mcpConfigs` 就 bash+curl 或自写搜索 API；把内置 `search`（grep/glob）当互联网检索
- ❌ 硬编码 API key / 忘记注册 createFlowTools()
- ❌ 引用已删除的 `platform_api` / `agent_variable` / `mcp_tool_bridge`
- ❌ 在 `src/libs/tools/` 写业务自定义工具（保护区）
- ❌ Zod 无 `.describe()` / 返回非 string
- ✅ 平台能力优先（dev-engineer-toolkit）→ native MCP → 内置 → app 层自写；**联网**另见 § 联网搜索
