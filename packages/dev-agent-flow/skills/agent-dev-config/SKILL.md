---
name: agent-dev-config
description: "deepagents-flow-ts 目标模板项目的开发期平台配置技能：封装 4sandbox/agent/dev/* 接口——搜索/添加/删除平台工具（Plugin/Workflow/Knowledge）、保存系统提示词与开场白。这些接口仅在开发期手动运行，不进 deepagents-flow-ts 运行时代码。核心流程：搜到可用工具 → 添加到 dev Agent 配置 → 按返回的 schema 在 src/libs/tools/ 用 tool() + Zod 实现 → 注册到 createFlowTools()。"
tags: [deepagents-flow-ts, agent-development, tool-config, system-prompt, dev-space, sandbox, plugin, workflow, knowledge]
version: "3.0.0"
license: MIT
---

# 平台工具配置与接入（deepagents-flow-ts）

## 模板身份边界

本 Skill 只服务于 `deepagents-flow-ts` 目标模板项目。本 Skill 是开发期配置说明，不是运行时业务项目。

当本文说“目标模板项目”“目标项目”“Agent 项目”时，默认都指用户基于 `deepagents-flow-ts` 创建、解压或分发出来的项目。不要把本 Skill 配置本身当作要开发或运行的业务模板。

用 **deepagents-flow-ts** 开发智能体时，本技能解决两件事：① 把**系统提示词 / 开场白**保存到开发平台配置；② 把**平台提供的工具**接入目标模板项目。平台工具虽多，但**必须先配置（搜索 → 添加）才能被框架使用**，随后按工具返回的 `schema` 在 `src/libs/tools/` 用 `tool()` + Zod 实现，注册到 `createFlowTools()`。所有配置操作面向 `4sandbox/agent/dev/*` 接口。

## 职责边界（务必区分）

本技能的 dev 接口与 `deepagents-flow-ts` 目标模板项目运行时代码是**两个层面**，不要混淆：

| 层面 | 是什么 | 何时运行 | 是否写进代码 |
|------|--------|----------|--------------|
| **配置层（dev 接口）** | config / search / add / del / update | **开发阶段**，由人/AI 手动跑，用来取关键数据、更新平台配置 | ❌ **不进 `deepagents-flow-ts` 运行时代码** |
| **工具层（实际工具）** | 按平台 `schema` 在 `src/libs/tools/` 用 `tool()` + Zod 实现的工具 | **运行时**，由目标模板项目的智能体实际调用 | ✅ 只有这一层写进代码 |

> 一句话：**dev 接口是开发期的"配置工具"，不是运行时被调用的工具。** 写进 `deepagents-flow-ts` 目标模板项目代码的，只有「实际要用到的工具」本身——按它的 schema 实现，而不是去 import 这些配置管理 API。

## When to Use

**首要场景**：用 `deepagents-flow-ts` 目标模板项目开发智能体时，需要让智能体调用平台工具或设置其系统提示词，就加载本技能，严格按 **搜索 → 添加到配置 → 按 schema 在 src/libs/tools/ 实现** 的顺序操作。

- 用 `deepagents-flow-ts` 目标模板项目开发智能体、需要接入平台工具 → **必须先搜索** dev 空间，不要凭记忆/臆测直接添加。
- 需要把**系统提示词 / 开场白**保存到平台配置（目标模板项目运行时读取）。
- 用户要**查看 / 查询**当前开发中的 Agent 配置（工具列表、systemPrompt、开场白）。
- 用户要给 Agent **添加**或**删除**工具（决定目标模板项目智能体可用哪些工具）。

> 完整接口字段表、请求/响应示例、错误码见 `references/api-docs.md`。
> `deepagents-flow-ts` 工具对接示例（`tool()` + Zod + `createFlowTools()`）见 `references/langgraph-integration.md`。
> 端点调用**必须**使用 `scripts/agent_tool.sh`（nuwaclaw / Git Bash 下统一入口，已处理 UTF-8）。**禁止**手写 `curl`/`Invoke-RestMethod` 拼含中文的 JSON body。

## 核心流程：平台工具接入 deepagents-flow-ts

平台提供大量工具供 `deepagents-flow-ts` 目标模板项目使用，但**未配置则不可用**。选定一个工具后，三步缺一不可：

1. **搜索** —— 在 dev 空间搜出可用工具，取得 `targetType` / `targetId` / `schema`。
2. **添加到配置** —— 用 `tool/add` 把工具加入当前开发 Agent 的配置；**只有配置后目标模板项目智能体才能调用它**，只引用 `targetId` 不添加则运行时不可用。
3. **按 schema 在 src/libs/tools/ 实现** —— 以工具返回的 `schema`（字符串化 JSON Schema）为准，在 `src/libs/tools/` 中用 `tool()` + Zod 实现该工具，注册到 `src/app/flow-tools.ts` 的 `createFlowTools()`。think 节点自动 `bindTools`，无需手动绑定。不要按臆测字段名开发。

> 口诀：**搜得到 → 加进配置 → 按它的 schema 在 src/libs/tools/ 用 tool() + Zod 实现 → 注册到 createFlowTools()**。三步必须一致指向同一个 `targetType` + `targetId`。

## 准备：环境变量

所有请求都需要以下环境变量，缺失时直接询问用户，不要凭空编造：

| 变量 | 用途 | 是否必填 |
|------|------|----------|
| `PLATFORM_BASE_URL` | 平台地址，如 `https://testagent.xspaceagi.com` | 所有接口 |
| `SANDBOX_ACCESS_KEY` | Bearer 鉴权令牌 | 所有接口 |
| `DEV_AGENT_ID` | 开发的 Agent ID（查询走路径、更新/增删走请求体 `devAgentId`） | 除搜索外所有接口 |
| `DEV_SPACE_ID` | dev 空间 ID | 仅搜索工具 |

> 若用户未提供，先用 `ask-question` 等方式确认，再继续。

## 典型工作流

### 1. 查询当前配置

先看清现状，再决定改动。

```bash
curl -s -X GET "${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/${DEV_AGENT_ID}" \
  -H "Authorization: Bearer ${SANDBOX_ACCESS_KEY}"
```

或：`./scripts/agent_tool.sh config`

### 2. 搜索可用工具

**这是接入工具的第一步，也是必须优先执行的动作**——拿到合法的 `targetType` 与 `targetId`，并取得 `schema`。不要凭记忆或臆测直接添加。

```bash
curl -s -X POST "${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/tool/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SANDBOX_ACCESS_KEY}" \
  -d "{\"devSpaceId\":${DEV_SPACE_ID},\"kw\":\"搜索\"}"
```

或：`./scripts/agent_tool.sh search --kw "搜索"`

从返回结果里挑出目标项，**三项都要记下**：

- `targetType`（`Plugin` / `Workflow` / `Knowledge`）
- `targetId`
- `schema`（对接该工具时构造入参的唯一依据）

### 3. 添加工具（硬约束 ①：必须加进配置）

用上一步得到的 `targetType` + `targetId` 添加——**只有添加后工具才会对 Agent 生效**：

```bash
curl -s -X POST "${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/tool/add" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SANDBOX_ACCESS_KEY}" \
  -d '{"devAgentId":'"${DEV_AGENT_ID}"',"targetType":"Plugin","targetId":611}'
```

或：`./scripts/agent_tool.sh add-tool --type Plugin --id 611`

### 3.5 按 schema 在 src/libs/tools/ 实现工具（硬约束 ②：以平台 schema 为准）

添加到配置后，在 `src/libs/tools/` 中实现该工具：**以第 2 步拿到的 `schema` 为唯一依据**，用 `tool()` + Zod 定义工具的入参，注册到 `createFlowTools()`。先解析 schema 看清字段：

```bash
echo '<搜索结果里的 schema 字符串>' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"
```

开发要点（参照 `src/libs/tools/platform-api.tool.ts` / `http-request.tool.ts` 写法）：

- **字段名、类型以 schema 为准**——Zod schema 的字段定义必须与平台 schema 对齐，不要臆造参数名。
- **类型映射**：`string`→`z.string()`、`integer`/`number`→`z.number()`、`boolean`→`z.boolean()`、`array`→`z.array()`、`object`→`z.record()`。
- `required` 列出的字段**必填**（不加 `.optional()`），其余加 `.optional()`。
- 添加的工具（`targetType`/`targetId`）与 `deepagents-flow-ts` 目标模板项目中实现/绑定的工具**必须是同一个**，不要"加 A 调 B"。
- **返回值必须为 string**：复杂对象用 `JSON.stringify()` 序列化。
- 注册路径：`src/libs/tools/xxx.tool.ts` → 在 `src/libs/tools/index.ts` re-export → 在 `src/app/flow-tools.ts` 的 `buildTools()` 数组中加入。
- `deepagents-flow-ts` 对接示例（`tool()` + Zod + `createFlowTools()`）见 `references/langgraph-integration.md`。

### 4. 删除工具

```bash
curl -s -X POST "${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/tool/delete" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SANDBOX_ACCESS_KEY}" \
  -d '{"devAgentId":'"${DEV_AGENT_ID}"',"targetType":"Plugin","targetId":611}'
```

或：`./scripts/agent_tool.sh del-tool --type Plugin --id 611`

### 5. 更新系统提示词 / 开场白

> ⚠️ **只改一个字段时，另一个字段必须省略，不能传空字符串**——传空会覆盖原值。

```bash
# 仅更新系统提示词（devAgentId 必填）
curl -s -X POST "${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/update" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SANDBOX_ACCESS_KEY}" \
  -d '{"devAgentId":'"${DEV_AGENT_ID}"',"systemPrompt":"You are a helpful assistant."}'
```

或用脚本（自动 UTF-8 编码，只带对应字段）：

```bash
# 短文本
./scripts/agent_tool.sh update-prompt  --text "You are a helpful assistant."
./scripts/agent_tool.sh update-opening --text "你好，有什么可以帮你？"

# 长文本 / 多行（从 UTF-8 文件读取）
./scripts/agent_tool.sh update-prompt --file prompts/weather-system.md
```

## 验证（每次写操作后必做）

任何 **add / delete / update** 之后，立即重新查询配置确认生效：

```bash
./scripts/agent_tool.sh config | jq '.data.tools[] | {targetType, targetId, name}'
```

- 成功标识：响应 `code: "0000"` 且 `success: true`。
- 工具列表应包含（或不再包含）目标项；prompt/开场白应反映新值。

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `code: "4000"` 提示"插件不存在或未发布" | 资源不存在或未发布 | 重新搜索确认 `targetId`；要求资源先发布 |
| 添加时报参数错误 | `targetType` 拼错或 `targetId` 非搜索所得 | 用搜索接口取值，枚举仅 `Plugin` / `Workflow` / `Knowledge` |
| 更新后 prompt 被清空 | 误传了空字符串 `"systemPrompt":""` | 只改开场白时**省略** `systemPrompt` 字段，或用 `update-opening` 命令 |
| 鉴权失败 / 401 | `SANDBOX_ACCESS_KEY` 缺失或过期 | 重新确认令牌 |
| 查询/更新/增删报参数错误或定位不到 Agent | `DEV_AGENT_ID` 缺失 | 确认开发 Agent ID 并写入 `DEV_AGENT_ID`（查询走路径、写操作走 body `devAgentId`） |
| 搜索接口报 dev space 错误 | `DEV_SPACE_ID` 缺失 | 确认 dev 空间 ID 并写入 `DEV_SPACE_ID` |
| 工具没生效 | 忘了在 `createFlowTools()` 注册 | 在 `src/app/flow-tools.ts` 的 `buildTools()` 数组中加入新工具 |
| `tool()` 返回类型错误 | 返回了对象而非 string | 用 `JSON.stringify()` 序列化 |
| systemPrompt 中文变 `????` 或乱码 | 手写 `curl`/`Invoke-RestMethod` 拼 JSON，请求体非 UTF-8 | 改用 `./scripts/agent_tool.sh`；长文本用 `--file` 读 UTF-8 文件后重传 |
| 终端显示乱码但 API 已成功 | 终端编码非 UTF-8 | 用 `./scripts/agent_tool.sh config` 或平台 Web UI / `jq` 核对为准 |

## Anti-patterns

- ❌ **把 dev 接口写进 `deepagents-flow-ts` 运行时代码**（`src/libs/tools/`）——config/search/add/del/update 是开发期配置操作，运行时不应出现；代码里只该有"实际要用的工具"本身。
- ❌ **未搜索就直接添加工具**，凭记忆猜 `targetId`——接入平台工具时，搜索是必须优先执行的第一步。
- ❌ **搜到了却没添加到配置**，就在 `deepagents-flow-ts` 目标模板项目里写工具——未 `tool/add` 进配置，平台侧不会路由调用。
- ❌ **不按 schema 开发工具**，按臆测的字段名/类型定义 `tool()`——入参 Zod schema 必须与搜索结果返回的 `schema` 对齐。
- ❌ **加 A 调 B**：配置中添加的工具与 `deepagents-flow-ts` 目标模板项目中实现的工具 `targetId` 不一致。
- ❌ 忘了在 `createFlowTools()` 的 `buildTools()` 中注册新工具。
- ❌ 写系统提示词到配置时**把不相关字段填成空字符串**，导致原值被覆盖——省略即可。
- ❌ 把 `${PLATFORM_BASE_URL}` / `${SANDBOX_ACCESS_KEY}` 当字面量写死在交付里——应来自环境变量。
- ❌ 写操作后**不做验证**就声称"已完成"——必须重新查询配置确认。
- ❌ **手写 `curl` / `Invoke-RestMethod` 拼含中文的 JSON body**——应使用 `./scripts/agent_tool.sh`。
- ✅ **代码里只写"实际用到的工具"**（`src/libs/tools/`），配置变更走 dev 接口（开发期手动跑），两者分离。
- ✅ 接入工具三步一致：**搜 → 加 → 按 schema 用 `tool()` + Zod 在 `src/libs/tools/` 实现 → 注册到 `createFlowTools()`**，指向同一 `targetType`+`targetId`。
- ✅ 系统提示词保存到平台配置，`deepagents-flow-ts` 目标模板项目运行时统一读取，避免在代码里硬编码。
- ✅ 每次写操作后调用 `config` 核对结果。
- ✅ 参照 `platform-api.tool.ts` / `http-request.tool.ts` 的 `tool()` + Zod 写法。

## 脚本速查

| 命令 | 作用 |
|------|------|
| `./scripts/agent_tool.sh config` | 获取 Agent 配置 |
| `./scripts/agent_tool.sh search --kw "关键词"` | 搜索可用工具 |
| `./scripts/agent_tool.sh add-tool --type Plugin --id 611` | 添加工具 |
| `./scripts/agent_tool.sh del-tool --type Plugin --id 611` | 删除工具 |
| `./scripts/agent_tool.sh update-prompt --text "..."` | 更新系统提示词（短文本） |
| `./scripts/agent_tool.sh update-prompt --file path.md` | 从 UTF-8 文件更新系统提示词（支持长文本） |
| `./scripts/agent_tool.sh update-opening --text "..."` | 更新开场白 |
| `./scripts/agent_tool.sh update-opening --file path.md` | 从 UTF-8 文件更新开场白 |

> 脚本会自动从 `DEV_AGENT_ID` 取值：查询拼进 URL 路径，更新/增删工具放入请求体 `devAgentId`；缺失时报错提示。搜索接口不受 `DEV_AGENT_ID` 影响。
