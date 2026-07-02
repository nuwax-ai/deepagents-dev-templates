# Part 3：工具 / MCP / 密钥

> 所属：`flow-builder` L2-C。入口路由见 [SKILL.md](../SKILL.md)。平台侧工具**登记**走 `dev-engineer-toolkit`（平台在线配置：tools / skills / mcpConfigs / systemPrompt，读写见该技能）；业务自定义 `tool()` **代码实现**在目标项目 `src/app/`。

需要添加自定义工具、配置 MCP、管理 API key 时读本层。

## 工具优先级（强制）

```
1. 平台能力（Plugin / Workflow / MCP）  ← dev-engineer-toolkit 搜索并 add-tool；登记即接入：运行期后端统一转 MCP
                                          经 ACP session/new mcpServers 下发 → ReAct 自动 bind / 图内按名引用，零包装代码
2. 内置 libs/tools                     ← bash/fs/search（**仅工作区 grep/glob**）/http/json/load_skill/task/demo（模板内置，勿改 libs）
3. 自写 src/app/ + flow-tools.ts       ← 最后手段：仅「平台确无命中」的真外部 API；在 app 层实现并注册 createFlowTools()
```

> **易错**：内置 `search` / `grep` = **仓库内** ripgrep/glob，**不是**联网搜索。联网/文档检索等能力**不由模板内置**，须平台登记 + **ACP 会话下发**。

> 已无 `mcp_tool_bridge` 元工具；MCP 工具由 runtime 原生绑定，直接用 server 暴露的工具名调用。

## 运行期统一 MCP 下发（关键模型）

**平台已登记的一切工具能力（Plugin / Workflow / MCP）运行期由平台后端统一转成 MCP**，经 ACP `session/new` 的 `mcpServers` 下发，与 `config/mcp.default.json` 合并（默认 `session-wins`）进 runtime。开发期只做「搜索 → 登记 →（管道才需要）按名接线」，**不写任何 HTTP 调用**；模板不在 `mcp.default.json` 内置搜索/文档 server。

```
开发期（写图前）                         运行期（ACP 会话）
─────────────────────────────────────────────────────────────
dev-engineer-toolkit                  ACP session/new
  search-apis / get-config               └ mcpServers { ... }   ← Plugin/Workflow/MCP 已统一转成 MCP
  add-tool → 平台登记                     merge(config/mcp.default.json)
  conversational ReAct → 零接线           session-wins（默认）
  固定管道 → searchMcp / docMcp           runtime → @langchain/mcp-adapters → allTools
  或工具名引用                            think ↔ tools 自动 bind / createMcpRetrievalNode
```

| 阶段 | 做什么 | 禁止 |
|------|--------|------|
| **开发期** | `search-apis` → `get-config`（tools / mcpConfigs）→ `add-tool`；conversational ReAct **零接线**；固定管道映射 `searchMcp`/`docMcp` 或依赖 session 下发的 server 名 | 照 Plugin `schema` 手写 fetch / `tool()` 包装；猜测平台内部端点（`4sandbox` 系仅 dev 脚本可用）；在 `mcp.default.json` 硬编码搜索包；`SEARCH_MCP = undefined` 报完成 |
| **运行期** | 平台/客户端经 **ACP** 下发 `mcpServers`（含由 Plugin/Workflow 转换来的 server），与本地 default 合并后进 runtime，`think ↔ tools` 自动可用 | 用 bash+curl / `http_request` 冒充已登记能力 |

> **反面教材（真实失败案例）**：开发 Agent 为已登记的「联网搜索 Plugin」手写了 `search.tool.ts` fetch 包装——端点是猜的（无文档依据）、envelope 是猜的（检查 `code==="200"`，平台惯例为 `"0000"`，必然判失败）、`fetch` 无超时 → 运行期搜索**一直卡住/全部返回空**。正确做法：`add-tool` 之后什么都不用写，运行期它就是一个 MCP 工具。

合并策略见下文 § MCP 配置；实现 seam → 目标项目 `src/surfaces/acp/server.ts`（`loadConfig` + `configureSession`）。

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
5. 命中 → `add-tool.sh` → **登记即接入**（运行期自动成为 MCP 工具）；conversational ReAct **零接线**，固定管道图内按名引用（`searchMcp` 等）
6. 记入 `project.md`（targetId、工具名、MCP 名、验证方式）
7. 平台**确无**命中 → 记录搜索输出 → **然后**方可走优先级 3 自写 app 工具

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

## 联网搜索（互联网 / 实时信息 · 常见专项）

> **说明**：联网搜索是 § 平台能力登记 中**最常见的专项**；下列规则在通用登记之上追加，不替代通用流程。

需求含**查互联网、最新资讯、实时数据、网页检索、多源调研**，或图/spec 使用 `mcp-retrieval` / `createMcpRetrievalNode` / `searchMcp` 时：先走上文 **§ 平台能力登记** 与 **§ 运行期统一 MCP 下发**，并追加搜索关键词与 `mcpConfigs` 检查。模板不提供开箱即用的联网搜索；**运行期搜索能力经 ACP 以 MCP server 注入**（Plugin 也会被后端转成 MCP）。

### 自动触发（满足任一即必读本节）

- 用户意图：搜索、联网、实时、网页、多源调研、资讯聚合
- Topology：`travel-planner` · `adaptive-rag` · `deep-research` · `search-aggregator` · 任意 custom 含 `type: "mcp-retrieval"`
- 代码信号：`createMcpRetrievalNode` · `createWebSearchNode` · `TravelSearchMcp` · `SEARCH_MCP`

**第一步（必做 · 写 spec/graph 之前）**：在 § 平台能力登记 基础上 → `search-apis.sh --kw "搜索"`（及 `联网` / `web`）→ `get-config.sh --key mcpConfigs` → 命中则 `add-tool.sh` 或同步 MCP。

### 选型表

| 优先级 | 来源 | 开发期 | 运行期 / 图内 |
|--------|------|--------|--------------|
| 1 | **平台搜索能力**（Plugin / MCP，运行期统一转 MCP 下发） | `search-apis.sh --kw "搜索"` / `"联网"` / `"web"` + `get-config.sh --key mcpConfigs` → `add-tool.sh`（**零包装代码**） | conversational ReAct 自动 bind（首选）；固定管道 `createMcpRetrievalNode` / `searchMcp` 按名引用 |
| 2 | **平台 Knowledge** | 同上（领域知识库） | 同上（RAG / 检索节点按名引用） |
| 3 | **本地 MCP 示例** | 仅平台确无搜索能力时，参考 `config/mcp.examples.json`（**不**提交进 default） | 同上；仍建议经 ACP session 下发 |
| 4 | **自写 app 工具** | 平台确无命中（须贴搜索证据） | `flow-tools.ts` |

### Topology wiring

| 场景 | 做法 |
|------|------|
| **conversational（default ReAct / `search-aggregator` 样板）** | **零接线**：`add-tool` 登记后运行期 MCP 工具自动进 `allTools`，`think ↔ tools` 自动 bind；只需 systemPrompt 引导使用搜索类工具 |
| `travel-planner` | `searchMcp` 接**平台登记**的搜索能力 → `createMcpRetrievalNode`；**运行期** ACP `mcpServers` 注入 |
| `deep-research` | `docMcp` 接**平台登记**的文档检索能力；**运行期** ACP `mcpServers` 注入 |
| `adaptive-rag` | 路由 `web_search`；经平台 `searchMcp`（`createWebSearchNode`）；**运行期** ACP `mcpServers` |
| `react-tools` / `dev-agent` | 平台能力运行期即 MCP 工具 → ReAct / `createToolExecNode` 自动执行 |
| **任意** custom / 手写管道 | spec 或 `graph.ts` 出现 `mcp-retrieval` / `searchMcp` → 按名引用平台下发的 server/tool |

### 优雅降级 vs 完成闸门（联网专项）

| 场景 | 图内行为 | 可否报「完成」 |
|------|----------|----------------|
| 已执行 § 平台能力登记 + 联网关键词搜索，平台**确无**搜索能力 | `searchMcp` 可缺省，research 写降级文案 | ✅ 须贴搜索无命中证据 |
| 平台**有**搜索能力，已 `add-tool`（conversational 零接线 / 固定管道已按名接线） | 正常检索 | ✅ 须附工具真实调用证据（`SMOKE_EXPECT_TOOL`，见 Part 4b） |
| **未执行**平台搜索就写联网图 | smoke 可能靠模型知识通过 | ❌ 见 § 平台能力登记 |

### 工作流（联网 · 在通用登记之上）

1. 完成 § 平台能力登记 步骤 1–4
2. `search-apis.sh --kw "<关键词> 搜索"`（及 `联网` / `web`）
3. `get-config.sh --key mcpConfigs`
4. 命中 → `add-tool.sh`；conversational ReAct **零接线**（运行期自动 bind）；固定管道图内接线（`searchMcp` 等）
5. 记入 `project.md`

### 禁止

- ❌ 内置 `search`/`grep` 当联网
- ❌ 未搜平台就 bash+curl、自写搜索 API、`http_request` 打搜索站
- ❌ 未搜平台就写图或报完成（需平台能力的 flow；联网较常见）
- ❌ 硬编码未在平台登记的第三方搜索 MCP（用平台源）
- ❌ 在 `src/libs/` 写搜索（保护区）

## 创建自定义工具 `src/app/tools/{name}.tool.ts`

> **仅限**平台**确无**命中的真外部 API（工具优先级 3，须先贴平台搜索无命中证据）。**平台已登记能力禁止走本节**——运行期它们已是 MCP 工具。

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

ACP 下副作用工具执行前可弹 `session/request_permission`。配置在**本地** `config/flow-agent.config.json`（workspace 配置，**非**平台在线配置）：

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

默认：`config/mcp.default.json`（**内置 `ask-question`** 结构化提问 fallback；**不**内置搜索/文档 server）；**运行期**由 ACP `session/new` 的 `mcpServers` 注入（与 default 合并，默认 **session-wins**，平台同名覆盖）。`human-in-loop` 等 HITL 拓扑**无需**范例级单独 `mcp.json`——包内已内置 fallback。开发期登记的平台 `mcpConfigs` 须在写图前经 `dev-engineer-toolkit` 对齐。

**平台问答卡片**（术语见目标项目 `docs/glossary.md` = 主平台在 ACP 宿主侧渲染的结构化提问 UI）：
- 图内 HITL 固定字段表单 → `present_review` + `review` 两节点（见 part2 § HITL 选型）
- **default ReAct 禁止**在 `think` 里自发调 `nuwax_ask_question`；审阅定稿走 `human-in-loop` 拓扑专用节点
- `ask-question` 已内置；平台同名 server **session-wins** 覆盖

HITL 表单选型详见模板 `docs/flow-patterns.md` § interrupt 人审、`src/libs/topologies/human-in-loop/`。

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
| `session-wins` | ACP session 覆盖 default（**runtime 当前行为**，默认） |
| `defaults-wins` | schema 已定义，**runtime 尚未读取**——勿依赖；实际恒 session-wins |

调试：`pnpm exec tsx src/index.ts capabilities`（列出 MCP server、内置工具、skills 分层）

---

## 密钥与环境变量

- 禁止硬编码密钥；工具内读 `process.env`；MCP server `env` 引用同名变量
- 运行时 **ACP session** 回注 `systemPrompt` 与 `mcpServers`（合并进 runtime）；**平台已登记的 Plugin/Workflow 也在其中**（后端统一转 MCP），**无需**任何 `src/app/` 包装器

---

## Anti-patterns

- ❌ **为已登记平台能力手写 fetch / `tool()` 包装**（真实失败案例三宗罪：猜端点、猜 envelope `code==="200"`、fetch 无超时 → 运行期卡住/全空；运行期它已是 MCP 工具）
- ❌ 不查平台能力 / 内置 / MCP 就自写工具
- ❌ **联网搜索**：未 `search-apis.sh` / 未查 `mcpConfigs` 就 bash+curl 或自写搜索 API；把内置 `search`（grep/glob）当互联网检索
- ❌ 运行时代码调用 `4sandbox` 系平台内部端点（仅 dev-engineer-toolkit 脚本可用）
- ❌ 硬编码 API key / 忘记注册 createFlowTools()
- ❌ 引用已删除的 `platform_api` / `agent_variable` / `mcp_tool_bridge`
- ❌ 在 `src/libs/tools/` 写业务自定义工具（保护区）
- ❌ Zod 无 `.describe()` / 返回非 string
- ✅ 平台能力优先（登记即接入，运行期统一 MCP 下发）→ 内置 → app 层自写；**联网**另见 § 联网搜索
