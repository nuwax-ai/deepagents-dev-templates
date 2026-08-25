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

凡 Agent 需**工作区以外**的能力（Plugin / Workflow / Knowledge / 平台技能 / 外部 API / 业务数据 / 联网检索等），**写 `graph.ts`、`flow-tools.ts` 或 `*.tool.ts` 之前必须**到平台查找并登记。当前项目内置工具不能替代业务 API。

### 防污染边界（目标 Agent vs 开发 Agent）

`flow-builder` / `dev-engineer-toolkit` / `flow-debugger` 是**本开发 Agent** 用来施工、登记和调试的技能，不是目标业务 Agent 的运行时能力。除非用户明确要创建“开发 Agent 本身”，否则：

- 禁止把这三个技能 `add-tool` 到目标业务 Agent 的 `skills/tools`
- 禁止把 `orchestration/skills/*` 复制、下载或解压到目标项目
- 禁止在目标 Agent `systemPrompt` 里列出这三个技能名
- 平台回读发现目标 Agent 已绑定这些技能时，先停止报完成，说明污染并移除 / 重新同步业务配置

目标业务 Agent 需要平台技能时，只登记与业务目标直接相关的技能；开发流程说明仍由本开发 Agent 当前会话加载，不下发给目标 Agent。

### 自动触发

- 用户要：调 API、接第三方、用知识库、平台技能、发通知、存取业务数据、或联网搜索
- 代码信号：新增 `tool()`、改 `flow-tools.ts`、默认 ReAct 需要业务工具、需要外部数据
- 场景信号：默认 ReAct 需业务工具、检索问答、多源搜索聚合、深度研究等

**豁免**：纯 LLM 对话；仅工作区内 `grep` / `glob` / `read_file`。

### 工作流（必须 · 写代码前）

1. 加载 `dev-engineer-toolkit`
2. `search-apis.sh --kw "<能力关键词>"`（按需求拆词，可多轮）—— 仅用于发现 `targetType` / `targetId`
3. 需领域技能 → `search-skills.sh --kw "<关键词>"`
4. 命中 → `add-tool.sh --target-type <type> --target-id <id>`（只负责平台登记/启用）
5. `get-config.sh --key tools --full` 确认该工具**已注册的真实工具名与 schema**；**禁止**照 search 结果手抄
6. 若登记的是 Skill，确认不是本开发 Agent 施工技能（`flow-builder` / `dev-engineer-toolkit` / `flow-debugger`）
7. 记入 `project.md`（targetId、真实工具名、验证方式）
8. 平台**确无**命中 → 记录搜索输出 → **然后**方可走优先级 3 自写 app 工具

### 工具登记与默认 ReAct 接线

平台 `add-tool` 只负责**登记/启用**。登记后的接线只有两条路径（细则见当前工作目录 `docs/capabilities.md`）：**宿主注入**会话，或版本化**固化**为 `FlowDef.platformToolRefs`——runtime 生成 `StructuredTool` 后并入 `runtime.allTools`，默认 ReAct 的 `think` 节点 `bindTools` 按需调用。

执行选型时：

1. 用 `get-config.sh --key tools --full` 的真实 `toolName` / `targetType` / `targetId` / 完整 `schema`，不要手抄搜索结果。
2. 需要版本化固化时，把完整配置写入 `FlowDef.platformToolRefs`；runtime 会生成 `StructuredTool`，不是让你再写 fetch / `tool()` 包装。
3. 调试时用 `flow-debugger` 确认本会话确实注入或装配了该工具。

禁止硬编码 URL、密钥或鉴权值；schema 里的 `${...}` 占位符由运行环境解析。

> **示例免责**：下列 `targetId` / 工具名均为**结构占位**，非真实工具；真实值**必须**经 `search-apis.sh` → `add-tool.sh` → `get-config.sh --key tools --full` 获取，**禁止照抄本文数值 / 名称**。

- 运行时工具名：优先用 `get-config` 返回的 `toolName`，否则按 `${targetType}_${targetId}` 自动拼（如 `Plugin_<id>`）；节点 / 集合里用这个名字定位工具。

### 三层工具名（生产易错 · `--expect-tool` 必读）

> 下表「形态示例」列仅示意**命名形态**（占位），非真实工具名；真实名以 `get-config --key tools --full` 返回为准。

| 层级 | 在哪出现 | 形态示例（占位） | 用途 |
|------|----------|------|------|
| **平台登记名** | `add-tool` / 提示词指引 | `<中文登记名>` | 提示词里告诉模型用哪个能力 |
| **SSE trace 名** | `componentExecuteResults[].name` | `platform__<tool>` | `debug.sh --expect-tool <tool>`（子串匹配） |
| **Runtime bindTools 名** | `bindTools` 后 / 图节点按名定位 | `platform__<tool>_<n>` | LLM 实际调用的工具名 |

**铁律**：
- `--expect-tool` 用 **runtime/SSE 英文子串**（如实际返回的 `<tool>` 片段或 `Plugin_<id>`），**禁止**用中文登记名
- `get-config --key tools --full` 后记录返回的 `toolName`，收工断言以 runtime 子串为准
- 提示词里可写中文登记名引导模型；flow-debugger 断言用 runtime 子串
- 若业务输出看似已调用工具但 `--expect-tool` 未命中，不算通过；用 flow-debugger `--show-trace` 或重新 `get-config --key tools --full` 确认 runtime/SSE 名称，修正断言后重跑同一主路径

### 默认 ReAct 接线示例

默认图 `think` 节点 `bindTools(runtime.allTools)`，模型按需调用；无需手写 HTTP，也无需建固定管道节点：

```typescript
// src/app/graph.ts（默认图已内置，通常无需改动）：
// think = model.bindTools(runtime.allTools) —— 平台工具经宿主注入或 platformToolRefs
// 固化后自动进入 allTools。
```

- **宿主注入**：平台登记后宿主把工具注入会话，`allTools` 自动可见。
- **固化**：把 `get-config --key tools --full` 的真实配置写入 `FlowDef.platformToolRefs`，runtime 生成 `StructuredTool` 并入 `allTools`。
- 固定流程顺序、人审确认等约束写进 systemPrompt，由默认 ReAct 承接（非 ReAct 图已屏蔽）。

### 完成闸门

| 场景 | 可否报「完成」 |
|------|----------------|
| 已执行平台搜索 + `get-config`，确无对应能力，已记录关键词与输出 | ✅ 可自写 app 工具 |
| 平台有命中，已 `add-tool`，且已固化或可被宿主注入（进入 `allTools` 供默认 ReAct 调用） | ✅ |
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
3. 命中 → `add-tool.sh`；经宿主注入或固化进入 `allTools`，默认 ReAct 按需调用
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

- ❌ 为已登记平台能力手写 fetch / `tool()` 包装（固化 `platformToolRefs` schema 允许，自写 HTTP 禁止）
- ❌ 不查平台能力就自写工具
- ❌ 联网搜索未走 `search-apis.sh` 就 bash+curl 或自写搜索 API
- ❌ 运行时代码调用 `4sandbox` 系平台内部端点（仅 dev-engineer-toolkit 脚本可用）
- ❌ 硬编码 API key / 忘记注册 createFlowTools()
- ❌ 在 `src/libs/tools/` 写业务自定义工具（保护区）
- ❌ Zod 无 `.describe()` / 返回非 string
- ✅ 平台能力优先 → 内置 → app 层自写；联网另见 § 联网搜索
