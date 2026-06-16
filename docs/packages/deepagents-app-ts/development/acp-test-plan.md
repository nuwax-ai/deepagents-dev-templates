# ACP 功能测试验证方案（Zed IDE）

## 概述

本方案覆盖通过 Zed 编辑器连接本项目的 ACP Server 后，对核心功能的逐项验证。
测试目标：确认 ACP 协议通信、会话管理、工具调用、流式输出等在 Zed 中均正常工作。

---

## 前置准备

### 1. 环境配置

```bash
# 进入项目目录
cd packages/template

# 安装依赖
npm install

# 确认 .env 已配置（至少一个 LLM 凭证）
cat .env
# 需要包含: ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN 或 OPENAI_API_KEY

# 编译项目
npm run build
```

### 2. Zed Agent 配置

在 Zed 中配置 ACP agent，编辑 `~/.config/zed/settings.json`（或 Zed Settings）：

```json
{
  "agent_servers": {
    "deepagents-template": {
      "type": "custom",
      "command": "node",
      "args": [
        "--import",
        "tsx",
        "/Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/src/index.ts",
        "--config",
        "/Users/apple/workspace/deepagents-dev-templates/packages/deepagents-app-ts/config/app-agent.config.json"
      ],
      "env": {
        "ANTHROPIC_API_KEY": "<你的 API Key>",
        "ANTHROPIC_BASE_URL": "<如有自定义>",
        "ANTHROPIC_MODEL": "<如有自定义>",
        "MAX_TOKENS": "16384",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

> **注意**：
> - Zed **不支持 `cwd` 字段**，工作目录自动设为当前打开的项目根目录。
> - `args` 中的路径必须使用**绝对路径**，因为 Zed 不保证从哪个目录启动进程。
> - `--config` 也应使用**绝对路径**，否则在打开 example/workspace 时会回退到默认配置，导致权限模式和模型配置不符合预期。
> - 如果 `.env` 已配置好凭证且项目根目录就是 `cwd`，`env` 块可省略，ACP Server 会自动加载 `.env` 作为 fallback。
> - Zed 会把 `env` 中的变量注入到 agent 进程的环境变量中，优先级高于 `.env` 文件。
> - 使用 `ANTHROPIC_API_KEY` 时，运行时会清理继承来的 `ANTHROPIC_AUTH_TOKEN`，避免 Anthropic-compatible gateway 收到冲突凭证后返回 401。

### 3. 验证 ACP Server 可独立启动

```bash
# 单元测试（含 ACP smoke test）
npm run test:acp-smoke

# 预期: initialize + session/new 测试通过，sessionId 匹配 /^sess_/
```

---

## ACP 协议实际 Update 类型（已验证）

> 以下为实际抓包确认的 `sessionUpdate` 类型，与文档假设不同。

| sessionUpdate 类型 | 含义 | 关键字段 |
|---|---|---|
| `available_commands_update` | 会话创建后推送可用命令 | `availableCommands[].name` |
| `agent_message_chunk` | Agent 文本响应（流式） | `content.text`, `content.type` |
| `tool_call` | 工具调用开始 | `kind`, `title`, `input`, `toolCallId` |
| `tool_call_update` | 工具调用进度/完成 | `status` (pending/in_progress/completed), `content` |

---

## 测试用例

### TC-01: ACP 连接建立 ✅

| 项目 | 内容 |
|------|------|
| **目标** | Zed 能成功连接 ACP Server |
| **操作** | 打开 Zed → Agent Panel → 选择 `deepagents-template` agent |
| **预期** | Agent Panel 显示已连接，无报错；Zed 状态栏显示 agent 名称 `my-scenario-agent` |
| **验证点** | `initialize` 握手成功，返回 `agentInfo.name`、`agentCapabilities` |
| **结果** | ✅ PASS — `agentInfo.name` = `my-scenario-agent`，`loadSession` = true，`commands` = true |

### TC-02: 新建会话（Session/New）✅

| 项目 | 内容 |
|------|------|
| **目标** | 能创建新的 ACP 会话 |
| **操作** | 在 Agent Panel 中发起新对话（New Thread） |
| **预期** | 会话创建成功，Agent 进入 `agent` 模式，返回 `sessionId`（格式 `sess_*`） |
| **验证点** | Zed 侧边栏出现新会话条目；服务端日志显示 `Session tracked` |
| **结果** | ✅ PASS — `sessionId` 格式 `sess_*`，`currentModeId` = `agent`，收到 `available_commands_update` |

### TC-03: 基本对话（Prompt → Response）✅

| 项目 | 内容 |
|------|------|
| **目标** | 发送 prompt 并收到流式响应 |
| **操作** | 输入 `"回复 hello world，不要说其他内容"` |
| **预期** | Agent 返回流式文本 |
| **验证点** | - 流式输出逐字呈现（非一次性返回）<br>- 服务端日志显示 `handlePrompt` 被调用<br>- 无报错或超时 |
| **结果** | ✅ PASS — 收到 `agent_message_chunk`，内容 `"Hello World"`，流式输出正常 |

### TC-04: 文件读取工具 ✅

| 项目 | 内容 |
|------|------|
| **目标** | Agent 能读取工作区文件 |
| **操作** | 输入 `"读取 package.json 并告诉我 name 字段的值，只输出值"` |
| **预期** | Agent 调用 `read_file` 工具，返回项目名称 `deepagents-dev-templates` |
| **验证点** | - Zed 显示工具调用过程（tool call indicator）<br>- 文件内容正确读取<br>- Zed 侧的 `readTextFile` 回调被触发 |
| **结果** | ✅ PASS — `readTextFile` 收到 `/package.json`（workspace 相对路径），正确读取并返回 `deepagents-dev-templates` |

### TC-05: 文件写入工具 ✅

| 项目 | 内容 |
|------|------|
| **目标** | Agent 能写入文件（带权限拦截） |
| **操作** | 输入 `"创建文件 acp-verify-test.txt，内容为 ACP_OK"` |
| **预期** | Agent 请求写入权限 → Zed 弹出权限确认 → 确认后文件创建成功 |
| **验证点** | - `write_file` 触发 `requestPermission` 回调<br>- Zed 显示权限确认对话框<br>- 文件创建后内容正确<br>- **拒绝权限**时文件不被创建 |
| **结果** | ✅ PASS — `requestPermission` 正确触发（kind=edit），拒绝后文件未创建，批准后文件创建且内容正确 |
| **修复** | `acp-server.ts` 添加 `streamAgentResponse` patch 处理 `__interrupt__` 事件 |

### TC-06: 文件编辑工具

| 项目 | 内容 |
|------|------|
| **目标** | Agent 能编辑已有文件 |
| **操作** | 先创建文件，再输入 `"把 test-acp.txt 的内容改为 'ACP edit test'"` |
| **预期** | Agent 调用 `edit_file`，文件内容被正确修改 |
| **验证点** | - 编辑操作精确匹配目标字符串<br>- 权限拦截正常工作 |

### TC-07: 自定义工具 - HTTP 请求

| 项目 | 内容 |
|------|------|
| **目标** | `http_request` 工具正常工作 |
| **操作** | 输入 `"用 http_request 工具访问 https://httpbin.org/get 并返回结果"` |
| **预期** | Agent 调用 `http_request`，返回 HTTP 响应内容 |
| **验证点** | 工具调用成功，返回有效的 JSON 响应 |

### TC-08: 自定义工具 - JSON 工具

| 项目 | 内容 |
|------|------|
| **目标** | `json_utils` 工具正常工作 |
| **操作** | 输入 `"用 json_utils 工具解析这个 JSON: {\"name\":\"test\",\"version\":\"1.0\"}"` |
| **预期** | Agent 调用 `json_utils`，返回解析结果 |
| **验证点** | JSON 解析/提取功能正常 |

### TC-09: 自定义工具 - Agent Memory

| 项目 | 内容 |
|------|------|
| **目标** | `agent_memory` 工具正常工作 |
| **操作** | 输入 `"用 agent_memory 工具保存一条记忆：用户喜欢中文回复"` |
| **预期** | Agent 调用 `agent_memory`，记忆被保存 |
| **验证点** | 记忆文件被正确写入 `.agent-memory/` 目录 |

### TC-10: 自定义工具 - Conversation History

| 项目 | 内容 |
|------|------|
| **目标** | `conversation_history` 工具正常工作 |
| **操作** | 发送几条消息后，输入 `"查看我们之前的对话历史"` |
| **预期** | Agent 调用 `conversation_history`，返回历史消息 |
| **验证点** | 历史消息包含之前发送的内容 |

### TC-11: 自定义工具 - Checkpoint

| 项目 | 内容 |
|------|------|
| **目标** | `checkpoint` 工具正常工作 |
| **操作** | 发送几条消息后，输入 `"保存当前会话的检查点"` |
| **预期** | Agent 调用 `checkpoint`，检查点被保存 |
| **验证点** | 检查点数据被正确记录 |

### TC-12: 多轮对话上下文保持

| 项目 | 内容 |
|------|------|
| **目标** | Agent 能保持多轮对话上下文 |
| **操作** | 1. `"我叫小明"` <br> 2. `"我刚才说我叫什么？"` |
| **预期** | Agent 回忆起用户说的"小明" |
| **验证点** | 上下文跨消息保持，无信息丢失 |

### TC-13: 会话取消（Cancel）

| 项目 | 内容 |
|------|------|
| **目标** | 能取消正在执行的请求 |
| **操作** | 发送一个复杂任务，在 Agent 响应过程中点击"停止"按钮 |
| **预期** | Agent 停止响应，会话恢复到可接收新消息的状态 |
| **验证点** | - 流式输出中断<br>- 后续消息能正常发送和接收<br>- 服务端日志显示 `handleCancel` |

### TC-14: 会话恢复（Stale Session Recovery）

| 项目 | 内容 |
|------|------|
| **目标** | 过期会话能自动恢复 |
| **操作** | 1. 创建会话并对话 <br> 2. 重启 ACP Server <br> 3. 在旧会话中继续发送消息 |
| **预期** | Agent 检测到会话失效后自动创建新会话，对话能继续 |
| **验证点** | 服务端日志显示 `Auto-created session for stale`；不报 `Session not found` 错误 |

### TC-15: 权限中断（Interrupt On）⚠️

| 项目 | 内容 |
|------|------|
| **目标** | 高危操作需要人工确认 |
| **操作** | 让 Agent 执行写文件、编辑文件、执行命令操作 |
| **预期** | 每次高危操作前 Zed 弹出权限确认对话框 |
| **验证点** | `write_file`、`edit_file`、`execute` 三个工具均触发权限确认 |
| **结果** | ✅ PASS — `requestPermission` 正确触发，4 个选项（allow-once/allow-always/reject-once/reject-always），Zed 弹出确认对话框 |

### TC-16: 被保护路径拒绝写入

| 项目 | 内容 |
|------|------|
| **目标** | `src/runtime/` 目录受保护 |
| **操作** | 输入 `"修改 src/runtime/acp-server.ts 的第一行为注释"` |
| **预期** | Agent 拒绝写入或写入被权限系统阻止 |
| **验证点** | 文件内容不被修改；Agent 或权限系统返回拒绝信息 |

### TC-17: MCP 工具桥接

| 项目 | 内容 |
|------|------|
| **目标** | MCP 工具能通过 `mcp_tool_bridge` 被发现和调用 |
| **操作** | 输入 `"列出所有可用的 MCP 工具"` 或 `"通过 MCP 调用某个工具"` |
| **预期** | Agent 调用 `mcp_tool_bridge`，返回 MCP 服务器列表或工具执行结果 |
| **验证点** | - MCP 服务器配置被正确加载<br>- 工具发现正常<br>- 如果配置了 MCP 服务器，工具可被调用 |

### TC-18: 平台 API 工具（本地模式）

| 项目 | 内容 |
|------|------|
| **目标** | 无平台凭证时工具返回明确错误 |
| **操作** | 输入 `"用 platform_api 查询插件列表"` |
| **预期** | Agent 调用 `platform_api`，返回"未配置平台凭证"之类的明确错误信息 |
| **验证点** | 不崩溃、不 hang，错误信息清晰 |

### TC-19: Agent Variable 工具

| 项目 | 内容 |
|------|------|
| **目标** | 变量管理工具正常工作 |
| **操作** | 输入 `"创建一个 agent variable 叫 MY_API_KEY"` |
| **预期** | Agent 调用 `agent_variable` 工具（本地模式下可能返回未配置平台的提示） |
| **验证点** | 工具不崩溃，返回合理响应 |

### TC-20: Debug 日志验证

| 项目 | 内容 |
|------|------|
| **目标** | Debug 模式下日志输出完整 |
| **操作** | 在 Zed 配置中设置 `"LOG_LEVEL": "debug"`，重启 agent，发送消息 |
| **预期** | 服务端输出包含详细的 debug 日志 |
| **验证点** | 日志包含：配置加载、工具创建、session 跟踪、prompt 处理等各阶段信息 |

---

## 测试矩阵

| 用例 | 类别 | 优先级 | 依赖 | 验证状态 |
|------|------|--------|------|----------|
| TC-01 | 连接 | P0 | 前置准备 | ✅ 已验证 |
| TC-02 | 会话 | P0 | TC-01 | ✅ 已验证 |
| TC-03 | 对话 | P0 | TC-02 | ✅ 已验证 |
| TC-04 | 工具-内置 | P0 | TC-02 | ✅ 已验证 |
| TC-05 | 工具-内置 | P0 | TC-02 | ✅ 已验证 |
| TC-06 | 工具-内置 | P1 | TC-05 | ⬜ |
| TC-07 | 工具-自定义 | P1 | TC-02 | ⬜ |
| TC-08 | 工具-自定义 | P1 | TC-02 | ⬜ |
| TC-09 | 工具-自定义 | P1 | TC-02 | ⬜ |
| TC-10 | 工具-自定义 | P2 | TC-02 | ⬜ |
| TC-11 | 工具-自定义 | P2 | TC-02 | ⬜ |
| TC-12 | 对话 | P0 | TC-02 | ⬜ |
| TC-13 | 会话 | P1 | TC-02 | ⬜ |
| TC-14 | 会话 | P1 | TC-02 | ⬜ |
| TC-15 | 权限 | P0 | TC-02 | ✅ 已验证 |
| TC-15b | 权限 | P0 | TC-15 | ✅ 已验证（allow_always 缓存） |
| TC-16 | 权限 | P0 | TC-02 | ⬜ |
| TC-17 | MCP | P2 | TC-02，需配置 MCP | ⬜ |
| TC-18 | 平台 | P2 | TC-02 | ⬜ |
| TC-19 | 平台 | P2 | TC-02 | ⬜ |
| TC-20 | 日志 | P2 | TC-02 | ⬜ |

---

## 执行顺序建议

```
第一轮（冒烟测试，约 10 分钟）
  TC-01 → TC-02 → TC-03 → TC-04 → TC-05 → TC-15

第二轮（核心功能，约 15 分钟）
  TC-06 → TC-07 → TC-08 → TC-09 → TC-12 → TC-13 → TC-16

第三轮（扩展功能，约 10 分钟）
  TC-10 → TC-11 → TC-14 → TC-17 → TC-18 → TC-19 → TC-20
```

---

## 已知风险与注意事项

1. **无 `cwd` 配置**：Zed 不支持 `cwd`，工作目录自动设为项目根目录。需在 Zed 中直接打开 `packages/deepagents-app-ts/` 作为项目，否则相对路径（配置文件、prompts、skills）会找不到
2. **LLM 凭证**：`.env` 中的 `ANTHROPIC_API_KEY` 指向 `open.bigmodel.cn`，需确认该 endpoint 的 ACP 兼容性
3. **ACP SDK 版本**：项目依赖 `deepagents-acp@latest`，需确认与 Zed 当前 ACP 实现兼容
4. **Zed ACP 支持**：部分功能（如 `loadSession`、`commands`）可能不完全可用
5. **权限弹窗**：Zed 的 `requestPermission` 实现可能与预期不同，需实际测试确认
6. **文件路径**：ACPFilesystemBackend 发送 workspace 相对路径（如 `/package.json`），客户端 `readTextFile` 回调需要拼上实际 workspace root 才能读到文件
7. **HITL 中断修复**：`deepagents-acp` 原生不处理 LangGraph 的 `__interrupt__` 事件，已通过 `acp-server.ts` 的 `streamAgentResponse` patch 修复。升级 `deepagents-acp` 时需确认官方是否已内置此修复

---

## 自动化验证脚本

验证脚本位于 `tests/acp-verify.ts`，可直接运行：

```bash
npx tsx tests/acp-verify.ts
```

脚本覆盖 TC-01 ~ TC-05 + TC-15，输出详细日志和通过/失败统计。

---

## 结果记录模板

| 用例 | 结果 | 备注 |
|------|------|------|
| TC-01 | ✅ | agentInfo.name=my-scenario-agent, loadSession=true, commands=true |
| TC-02 | ✅ | sessionId=sess_*, mode=agent, available_commands_update 收到 |
| TC-03 | ✅ | agent_message_chunk "Hello World"，流式输出正常 |
| TC-04 | ✅ | readTextFile(/package.json) 正确读取，返回 deepagents-dev-templates |
| TC-05 | ✅ | requestPermission 触发，拒绝→文件不创建，批准→文件创建且内容正确 |
| TC-06 | ⬜ | |
| TC-07 | ⬜ | |
| TC-08 | ⬜ | |
| TC-09 | ⬜ | |
| TC-10 | ⬜ | |
| TC-11 | ⬜ | |
| TC-12 | ⬜ | |
| TC-13 | ⬜ | |
| TC-14 | ⬜ | |
| TC-15 | ✅ | 4 个权限选项，Zed 弹出确认对话框 |
| TC-15b | ✅ | allow_always 缓存生效，第二次写文件无弹窗自动批准 |
| TC-16 | ⬜ | |
| TC-17 | ⬜ | |
| TC-18 | ⬜ | |
| TC-19 | ⬜ | |
| TC-20 | ⬜ | |
