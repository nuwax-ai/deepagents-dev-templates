# API 接口文档

> 基于平台 OpenAPI 规范的实际接口参考。
>
> **认证、基址、`devSpaceId`/`devAgentId` 均由对应 `scripts/*.sh` 从环境变量读取并填充，请勿手写 HTTP 调用。**

---

## 环境变量

所有脚本依赖以下环境变量（运行时由平台注入，脚本内部自动读取；**用户无需手动配置**）：

| 环境变量 | 说明 | 使用脚本 |
|----------|------|----------|
| `PLATFORM_BASE_URL` | 平台 API 基础地址（必填） | 全部 |
| `SANDBOX_ACCESS_KEY` | 沙箱认证密钥，用作 Bearer Token（必填） | 全部 |
| `DEV_SPACE_ID` | 开发空间 ID（必填） | `search-apis.sh`、`search-skills.sh`、`download-skill.sh` |
| `DEV_AGENT_ID` | 当前开发的 Agent ID（必填） | `add-tool.sh`、`remove-tool.sh`、`get-config.sh`、`update-config.sh` |

脚本在缺失必需环境变量时输出明确错误并以 exit code `2` 退出。

---

## 接口概览

| 类别 | 接口路径 | 方法 | 对应脚本 |
|------|----------|------|----------|
| 资源搜索 | `/api/v1/4sandbox/agent/dev/tool/search` | POST | `scripts/search-apis.sh` / `scripts/search-skills.sh`（→ `search-tools.py`） |
| 注册工具 | `/api/v1/4sandbox/agent/dev/config/tool/add` | POST | `scripts/add-tool.sh` |
| 删除工具 | `/api/v1/4sandbox/agent/dev/config/tool/delete` | POST | `scripts/remove-tool.sh` |
| 获取配置 | `/api/v1/4sandbox/agent/dev/config/{devAgentId}` | GET | `scripts/get-config.sh`（→ `get-config.py`） |
| 更新配置 | `/api/v1/4sandbox/agent/dev/config/update` | POST | `scripts/update-config.sh`（→ `update-config.py`） |

---

## 1. 资源搜索接口

搜索平台中的工具（API）、技能等资源。

### 请求

```
POST {PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/tool/search
Content-Type: application/json
Authorization: Bearer {SANDBOX_ACCESS_KEY}
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `devSpaceId` | int64 | ✅ | 开发空间 ID，从 `DEV_SPACE_ID` 环境变量获取 |
| `type` | string | ✅ | 搜索类型：`"tool"` — 搜索工具/API（Plugin, Workflow, Knowledge 等）；`"skill"` — 搜索技能 |
| `kw` | string | 否 | 关键词搜索 |
| `page` | int32 | 否 | 页码 |
| `pageSize` | int32 | 否 | 每页数量 |

### 响应体结构

```json
{
  "code": "0000",
  "success": true,
  "data": [
    {
      "targetType": "Plugin",
      "targetId": 123,
      "name": "文件上传",
      "description": "上传文件到对象存储",
      "schema": "{...接口定义 JSON...}"
    }
  ],
  "message": null,
  "displayCode": "0000",
  "tid": "trace-xxx"
}
```

### 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `code` | string | 业务状态码，`"0000"` 表示成功 |
| `success` | boolean | 是否成功 |
| `data` | array | 搜索结果列表 |
| `message` | string | 错误描述信息（成功时为 null） |
| `displayCode` | string | 源系统状态码，用于问题跟踪 |
| `tid` | string | 跟踪唯一标识 |

### 结果条目字段 (ToolSearchResultItemDTO)

| 字段 | 类型 | 说明 |
|------|------|------|
| `targetType` | string | 目标类型枚举 |
| `targetId` | int64 | 目标对象 ID |
| `name` | string | 目标对象名称 |
| `description` | string | 目标对象描述 |
| `schema` | string | 目标对象接口定义（JSON 字符串） |

### targetType 枚举

| 值 | 说明 | 搜索类型 |
|----|------|----------|
| `Plugin` | 插件 API | tool |
| `Workflow` | 工作流 API | tool |
| `Knowledge` | 知识库 | tool |
| `Skill` | 技能 | skill |

---

## 2. 注册工具接口

将搜索到的工具/技能注册到当前智能体项目。

### 请求

```
POST {PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/tool/add
Content-Type: application/json
Authorization: Bearer {SANDBOX_ACCESS_KEY}
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `devAgentId` | int64 | ✅ | 当前开发的 Agent ID，从 `DEV_AGENT_ID` 环境变量获取 |
| `targetType` | string | 否 | 目标类型：`Plugin`、`Workflow`、`Knowledge`、`Skill` |
| `targetId` | int64 | 否 | 目标对象 ID，来自搜索结果中的 `targetId` |

### 响应

```json
{
  "code": "0000",
  "success": true,
  "data": null,
  "message": null
}
```

---

## 3. 删除工具接口

从当前智能体项目移除已注册的工具/技能。

### 请求

```
POST {PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/tool/delete
Content-Type: application/json
Authorization: Bearer {SANDBOX_ACCESS_KEY}
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `devAgentId` | int64 | ✅ | 当前开发的 Agent ID，从 `DEV_AGENT_ID` 环境变量获取 |
| `targetType` | string | 否 | 目标类型：`Plugin`、`Workflow`、`Knowledge`、`Skill` |
| `targetId` | int64 | 否 | 目标对象 ID |

### 响应

```json
{
  "code": "0000",
  "success": true,
  "data": null,
  "message": null
}
```

---

## 4. 获取项目配置接口

查询当前智能体项目的完整配置信息。

### 请求

```
GET {PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/{devAgentId}
Authorization: Bearer {SANDBOX_ACCESS_KEY}
```

```bash
# 摘要查看
./scripts/get-config.sh --key tools
```

### 路径参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `devAgentId` | int64 | ✅ | 当前开发的 Agent ID，从 `DEV_AGENT_ID` 环境变量获取 |

### 响应

```json
{
  "code": "0000",
  "success": true,
  "data": {
    "systemPrompt": "你是一个专业的开发助手...",
    "openingChatMsg": "你好！我可以帮你开发项目。",
    "tools": [
      {
        "targetType": "Plugin",
        "targetId": 614,
        "name": "token价格查询",
        "description": "...",
        "schema": "{...}"
      }
    ],
    "skills": [
      {
        "id": 494,
        "name": "flow-verify-and-test",
        "description": "...",
        "downloadUrl": "https://s3p.nuwax.com:9443/xxx.zip"
      }
    ],
    "mcpConfigs": [
      {
        "name": "my-mcp-server",
        "description": "...",
        "serverConfig": "{...}",
        "usedTool": "..."
      }
    ]
  },
  "message": null
}
```

### 子类型说明

**ToolSearchResultItemDTO**（tools 列表元素）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `targetType` | string | 目标类型：`Plugin`、`Workflow`、`Knowledge`、`Skill` |
| `targetId` | int64 | 目标对象 ID |
| `name` | string | 工具名称 |
| `description` | string | 工具描述 |
| `schema` | string | 接口定义或参数说明 |

**SkillResultItemDTO**（skills 列表元素）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int64 | 技能 ID |
| `name` | string | 技能名称 |
| `description` | string | 技能描述 |
| `downloadUrl` | string | 技能下载链接 |

**McpResultDTO**（mcpConfigs 列表元素）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | MCP 服务名称 |
| `description` | string | 描述 |
| `serverConfig` | string | 服务配置 |
| `usedTool` | string | 使用的工具 |

---

## 5. 更新项目配置接口

更新智能体的系统提示词和/或开场白。

> **编码**：请求体必须为 **UTF-8 JSON**。请使用 `scripts/update-config.sh`（→ `update-config.py`）、`scripts/search-apis.sh` / `search-skills.sh`（→ `search-tools.py`）。含中文长文本用 `--system-prompt-file` / `--kw-file` 读 UTF-8 文件。禁止手写 `curl`/`Invoke-RestMethod` 拼中文 body。

### 请求

```
POST {PLATFORM_BASE_URL}/api/v1/4sandbox/agent/dev/config/update
Content-Type: application/json; charset=utf-8
Authorization: Bearer {SANDBOX_ACCESS_KEY}
```

### 请求体

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `devAgentId` | int64 | ✅ | 当前开发的 Agent ID，从 `DEV_AGENT_ID` 环境变量获取 |
| `systemPrompt` | string | 否 | 系统提示词，留空不修改 |
| `openingChatMsg` | string | 否 | 开场白/欢迎语，留空不修改 |

### 响应

```json
{
  "code": "0000",
  "success": true,
  "data": null,
  "message": null
}
```

---

## 错误码

| HTTP 状态码 | 说明 |
|-------------|------|
| 200 | 成功（仍需检查响应体 `code` 是否为 `0000`） |
| 403 | 禁止访问（权限不足） |
| 4xx/5xx | 其他错误 |

### 业务错误码

| code | 说明 |
|------|------|
| `0000` | 成功 |
| 其他 | 失败，详见 `message` 字段 |
