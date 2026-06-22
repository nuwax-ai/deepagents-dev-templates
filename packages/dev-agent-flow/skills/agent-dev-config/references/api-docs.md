# Agent Tool Configuration — API Reference

完整的接口字段、请求/响应示例与错误码说明。SKILL.md 中的操作指南引用本文件，需要核对具体字段时查阅此处。

> **定位：这些接口只在开发阶段使用**——用来查询/获取关键数据、更新平台配置（搜索工具、添加/删除工具、保存系统提示词）。它们由人/AI 在开发期手动运行，**不应出现在 LangGraph 业务代码里**；写进代码的只有"实际要用到的工具"本身（见 `langgraph-integration.md`）。

## 通用约定

| 项 | 值 |
|----|----|
| Base URL | `${PLATFORM_BASE_URL}`（例如 `https://testagent.xspaceagi.com`） |
| 鉴权 | `Authorization: Bearer ${SANDBOX_ACCESS_KEY}` |
| Content-Type | `application/json; charset=utf-8`（含中文时务必 UTF-8） |
| 成功标识 | `code: "0000"` 且 `success: true` |

### 中文编码（systemPrompt / openingChatMsg）

平台按 **UTF-8 JSON** 解析请求体。Windows 开发机上常见乱码原因：

| 错误做法 | 后果 |
|----------|------|
| PowerShell `Invoke-RestMethod -Body ($obj \| ConvertTo-Json)` | 请求体常按系统 ANSI（如 GBK）发送，中文入库变 `????` |
| 终端里直接拼含中文的 curl 且 shell 编码非 UTF-8 | 偶发乱码 |

**正确做法**：使用 `./scripts/agent_tool.sh`（已统一 UTF-8），例如 `./scripts/agent_tool.sh update-prompt --file prompts/system.md`。

写操作后用 `config` 核对 `data.systemPrompt` 是否含正确中文；若已乱码，用上述脚本**重新上传**即可覆盖修复。

所有接口前缀：`/api/v1/4sandbox/agent/dev`

**环境变量：**

| 变量 | 用途 | 使用接口 |
|------|------|----------|
| `PLATFORM_BASE_URL` | 平台地址 | 所有 |
| `SANDBOX_ACCESS_KEY` | Bearer 鉴权令牌 | 所有 |
| `DEV_AGENT_ID` | 开发的 Agent ID | 查询（路径）、更新/增删工具（请求体 `devAgentId`） |
| `DEV_SPACE_ID` | dev 空间 ID | 仅搜索 |

> `devAgentId`（取自 `DEV_AGENT_ID`，Long 类型）在查询接口走 **URL 路径**；在更新 prompt/开场白、添加/删除工具接口走 **JSON 请求体字段**，且均为必填。

---

## 1. 获取 Agent 配置

获取指定开发 Agent 的完整配置。`devAgentId` 通过 URL 路径传递。

```
GET ${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/{devAgentId}
```

**路径参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `devAgentId` | Long | 开发的 Agent ID，取自 `DEV_AGENT_ID` 环境变量 |

**请求示例：**

```bash
curl -s -X GET "${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/${DEV_AGENT_ID}" \
  -H "Authorization: Bearer ${SANDBOX_ACCESS_KEY}"
```

**响应结构**（`ReqResultDevAgentConfigDTO`）：

```json
{
  "code": "0000",
  "message": "success",
  "data": {
    "systemPrompt": "...",
    "openingChatMsg": "...",
    "tools": [
      {
        "targetType": "Plugin",
        "targetId": 18,
        "name": "token价格查询",
        "description": "...",
        "schema": "..."
      }
    ],
    "skills": [],
    "mcpConfigs": []
  },
  "success": true
}
```

| data 字段 | 含义 |
|-----------|------|
| `systemPrompt` | 当前系统提示词 |
| `openingChatMsg` | 开场白消息 |
| `tools[].targetType` | 工具来源类型：`Plugin` / `Workflow` / `Knowledge` |
| `tools[].targetId` | 工具目标对象 ID（增删时使用） |
| `tools[].name` | 工具名称 |
| `tools[].description` | 工具描述 |
| `tools[].schema` | 工具参数 schema（字符串化 JSON） |

---

## 2. 更新 Agent 配置

更新系统提示词和/或开场白消息。**留空或省略的字段保持原值不变**。

```
POST ${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/update
Content-Type: application/json
```

**请求体**（`DevAgentConfigUpdateDTO`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `devAgentId` | Long | ✅ | 开发的 Agent ID，取自 `DEV_AGENT_ID` |
| `systemPrompt` | string | ❌ | 系统提示词；省略则不变 |
| `openingChatMsg` | string | ❌ | 开场白消息；省略则不变 |

> ⚠️ 若只想改 `openingChatMsg`，**不要**带上空字符串的 `systemPrompt`，直接省略该字段即可，避免把已有 prompt 清空。`devAgentId` 为必填，不可省略。

**请求示例：**

```bash
curl -s -X POST "${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/update" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SANDBOX_ACCESS_KEY}" \
  -d '{"devAgentId":'"${DEV_AGENT_ID}"',"systemPrompt":"You are a helpful assistant."}'
```

**成功响应：** `code: "0000"`, `success: true`

---

## 3. 搜索可用工具

在 dev 空间内搜索可添加到 Agent 的工具/资源。**添加工具前必须先调用此接口**，取得合法的 `targetType` 与 `targetId`。

> 本接口以 `devSpaceId`（取自 `DEV_SPACE_ID`）定位资源空间，**不需要** `devAgentId`。

```
POST ${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/tool/search
Content-Type: application/json
```

**请求体**（`ToolSearchDTO`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `devSpaceId` | integer | ✅ | dev 空间 ID（取环境变量 `DEV_SPACE_ID`） |
| `page` | integer | ❌ | 页码 |
| `pageSize` | integer | ❌ | 每页条数 |
| `kw` | string | ❌ | 关键词 |

**请求示例：**

```bash
curl -s -X POST "${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/tool/search" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SANDBOX_ACCESS_KEY}" \
  -d "{\"devSpaceId\":${DEV_SPACE_ID},\"kw\":\"搜索\"}"
```

**响应结构**（`ReqResultListToolSearchResultItemDTO`）：

```json
{
  "code": "0000",
  "data": [
    {
      "targetType": "Plugin",
      "targetId": 611,
      "name": "联网搜索_1",
      "description": "...",
      "schema": "{...}"
    }
  ],
  "success": true
}
```

**`targetType` 枚举：** `Plugin`、`Workflow`、`Knowledge`

---

## 4. 添加工具到 Agent

把搜索结果中的工具加入 Agent 配置。

```
POST ${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/tool/add
Content-Type: application/json
```

**请求体**（`ToolAddDTO`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `devAgentId` | Long | ✅ | 开发的 Agent ID，取自 `DEV_AGENT_ID` |
| `targetType` | string | ✅ | `Plugin` / `Workflow` / `Knowledge` |
| `targetId` | integer | ✅ | 来自搜索结果的目标对象 ID |

**请求示例：**

```bash
curl -s -X POST "${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/tool/add" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SANDBOX_ACCESS_KEY}" \
  -d '{"devAgentId":'"${DEV_AGENT_ID}"',"targetType":"Plugin","targetId":611}'
```

**错误码：**

| code | message | 含义 |
|------|---------|------|
| `4000` | 插件不存在或未发布 | 资源不存在或未发布，需先发布或换一个 |

---

## 5. 从 Agent 删除工具

从 Agent 配置中移除工具。

```
POST ${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/tool/delete
Content-Type: application/json
```

**请求体**（`ToolDeleteDTO`）：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `devAgentId` | Long | ✅ | 开发的 Agent ID，取自 `DEV_AGENT_ID` |
| `targetType` | string | ✅ | 同添加接口 |
| `targetId` | integer | ✅ | 要移除的目标对象 ID |

**请求示例：**

```bash
curl -s -X POST "${PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/tool/delete" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SANDBOX_ACCESS_KEY}" \
  -d '{"devAgentId":'"${DEV_AGENT_ID}"',"targetType":"Plugin","targetId":611}'
```

---

## 端点速查表

| 操作 | 方法 | 路径 | devAgentId 位置 |
|------|------|------|-----------------|
| 获取配置 | GET | `/config/{devAgentId}` | URL 路径 |
| 更新 prompt/开场白 | POST | `/config/update` | 请求体（必填） |
| 搜索可用工具 | POST | `/tool/search` | 不需要（用 `devSpaceId`） |
| 添加工具 | POST | `/config/tool/add` | 请求体（必填） |
| 删除工具 | POST | `/config/tool/delete` | 请求体（必填） |
