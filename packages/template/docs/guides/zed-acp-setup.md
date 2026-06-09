# Zed ACP 配置

在 Zed 的 `settings.json` 中注册本模板 agent 时，可以使用下面的配置。

OpenAI-compatible 是 `.nuwax-agent` 规划中的默认云电脑调试 profile；配置面板、能力来源分层和打包安装生命周期见：

- [Scenario Agent Template Design](./scenario-agent-template-design.md)
- [Package Install Lifecycle](./package-install-lifecycle.md)

编辑 `~/.config/zed/settings.json`：

```json
{
  "agent_servers": {
    "deepagents-template": {
      "type": "custom",
      "command": "node",
      "args": [
        "--import",
        "tsx",
        "/absolute/path/to/deepagents-dev-templates/packages/template/src/index.ts",
        "--config",
        "/absolute/path/to/deepagents-dev-templates/packages/template/config/app-agent.config.json"
      ],
      "env": {
        "LLM_PROVIDER": "openai",
        "OPENAI_MODEL": "mimo-v2.5-pro",
        "OPENAI_BASE_URL": "<your-openai-compatible-base-url>",
        "OPENAI_API_KEY": "<your-api-key>",
        "MAX_TOKENS": "16384",
        "LOG_LEVEL": "debug",
        "LOG_DIR": "/absolute/path/to/deepagents-dev-templates/logs"
      }
    }
  }
}
```

注意事项：

- 使用绝对路径。Zed 会从当前打开的项目根目录启动 ACP server，不一定是这个 package 目录。
- `--config` 也要使用绝对路径。这样即使 Zed 打开的是 example 项目，server 仍会读取模板的 `config/app-agent.config.json`。
- 不要把真实 API key 提交进仓库；上面的 `<your-api-key>` 是占位符。
- OpenAI-compatible profile 应只注入 `OPENAI_*` 模型凭据，避免同时注入 Anthropic 与 OpenAI 两套 key/baseUrl。
- `LLM_PROVIDER` 可省略：仅配置 `OPENAI_API_KEY` / `OPENAI_BASE_URL` 时运行时会自动选用 `openai` 协议。
- 以 `/` 开头的**绝对路径**在 runtime 侧不会当作 slash command；但 Zed 客户端仍可能先拦截这类输入——可在路径前加空格，或改用相对路径描述。
- Anthropic-compatible gateway 仍受支持，但作为备用 profile 维护；如果父进程环境里有旧的 `ANTHROPIC_AUTH_TOKEN`，运行时会在检测到 `ANTHROPIC_API_KEY` 后自动清理它，避免网关收到冲突凭证后返回 401。
- 修改 `settings.json` 后需要重启或 reload Zed。

快速验证：

```bash
LLM_PROVIDER=openai \
OPENAI_MODEL=mimo-v2.5-pro \
OPENAI_BASE_URL=<your-openai-compatible-base-url> \
OPENAI_API_KEY=<your-api-key> \
LOG_LEVEL=debug \
LOG_DIR=/absolute/path/to/deepagents-dev-templates/logs \
node --import tsx /absolute/path/to/deepagents-dev-templates/packages/template/src/index.ts \
  --config /absolute/path/to/deepagents-dev-templates/packages/template/config/app-agent.config.json
```

预期启动日志信号：

- `name` 是 `my-scenario-agent`
- `LLM_PROVIDER` 是 `openai`
- `OPENAI_MODEL` 是 Zed settings 中配置的值
- 模板配置以 `yolo` 模式加载时，`permissions` 是 `1`

## Slash Commands

ACP/Zed 场景下，Zed 会收到 `available_commands_update`，其中包含 deepagents-acp 内置命令和本模板注册的命令。

本模板额外支持：

- `/help`
- `/tools`
- `/config`
- `/status`
- `/sessions`
- `/session`
- `/plan`
- `/history`
- `/memory`
- `/checkpoints`
- `/migrate-state`
- `/approvals`

deepagents-acp 内置命令继续可用：

- `/agent`
- `/ask`
- `/clear`

CLI REPL 和 ACP 共用 `src/runtime/slash-commands.ts` 中的命令定义。新增跨场景命令时，应先放进这个 registry，再在 ACP server 中确认是否需要会话级副作用。

## Plan、会话、记忆和检查点在哪里

运行态数据默认不写入项目仓库，而是写到用户级目录：

```text
~/.deepagents/workspaces/<workspace-slug>/
```

其中：

- `metadata.json`：当前 workspace 的元信息。
- `memory/<agent-name>/MEMORY.md`：agent 长期记忆。
- `sessions/<session-id>/metadata.json`：单个会话元信息。
- `sessions/<session-id>/messages.jsonl`：会话消息记录。
- `sessions/<session-id>/plan.md`：当前会话 plan。
- `sessions/<session-id>/todos.json`：当前会话 TODO 状态。
- `sessions/<session-id>/checkpoints/*.md`：当前会话检查点。
- `sessions/<session-id>/artifacts/`：会话产物目录。

旧目录兼容：

- `.agent-memory/<agent-name>/MEMORY.md`：新 memory 为空时仍可读。
- `.agent-checkpoints/*.md`：仍可列出/rewind，但删除只作用于新 session storage。

迁移旧数据：

```text
/migrate-state
```

该命令会把 `.agent-memory` 和 `.agent-checkpoints` 复制到 `~/.deepagents/workspaces/<workspace-slug>/...`，不会删除旧目录。

## 配置加载顺序

最终配置按下面顺序合并，后者覆盖前者：

1. 内置默认值
2. `~/.deepagents/config.json`
3. `~/.deepagents/models.json`
4. `~/.deepagents/mcp.json`
5. `<workspace>/.deepagents/config.json`
6. `<workspace>/.deepagents/mcp.json`
7. `--config` 指定的模板配置，例如 `config/app-agent.config.json`
8. 用户级/项目级 plugin manifests
9. 环境变量
10. ACP/Zed session config

合并规则：

- `mcp.json` 和 inline `mcp.servers` 按 server name 合并，后加载的同名 server 覆盖前面的。
- `skills.directories`、`agentsDirectories`、`plugins.directories` 会 concat + dedupe。
- `model.name`、`model.baseUrl`、`model.settings.maxTokens` 等标量字段后者覆盖前者。
- API key 推荐通过环境变量提供，例如 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`；不要写进项目配置。

默认资源目录：

- skills：`~/.deepagents/skills`、`<workspace>/.deepagents/skills`、模板内置 skills。
- agents/subagents：`~/.deepagents/agents`、`<workspace>/.deepagents/agents`、`<workspace>/.agents/agents`。
- plugins：`~/.deepagents/plugins`、`<workspace>/.deepagents/plugins`。

工作目录可以通过三种方式设置：

- CLI：`--cwd <path>` 或 `--working-dir <path>`
- 环境变量：`DEEPAGENTS_WORKING_DIR` 或 `AGENT_WORKING_DIR`
- 配置：`workspace.workingDir`

用户级 `workspace.workingDir` 会用于定位项目级 `.deepagents/config.json`。

Plugin manifest 示例：

```json
{
  "id": "my-plugin",
  "skillsDirectories": ["skills"],
  "agentsDirectories": ["agents-root"],
  "mcpServers": {
    "docs": { "command": "node", "args": ["server.mjs"] }
  },
  "hooks": [
    {
      "event": "pre_tool_use",
      "matcher": "^execute$",
      "command": "node hooks/check-command.mjs"
    }
  ]
}
```

manifest 中的相对路径以 `plugin.json` 所在目录为基准。

## System Prompt 与 AGENTS.md

系统提示词优先级：

1. ACP/Zed session 传入的 `systemPrompt`
2. 配置里的 `agent.systemPrompt`
3. 配置里的 `agent.systemPromptPath`
4. 默认 `prompts/developer-agent.system.md`
5. 内置 fallback prompt

可以通过环境变量覆盖：

- `AGENT_SYSTEM_PROMPT`
- `AGENT_SYSTEM_PROMPT_PATH`

项目根目录的 `AGENTS.md` 会作为 workspace instructions 加载到 deepagents memory 系统中；同一逻辑也会检查：

- `AGENTS.md`
- `CLAUDE.md`
- `.deepagents/AGENTS.md`
- `.deepagents/agent.md`

如果项目不希望加载这些说明文件，可以在配置中设置：

```json
{
  "agent": {
    "includeWorkspaceInstructions": false
  }
}
```

## Hooks 与审批

可以在用户级或项目级配置中声明 shell hooks：

```json
{
  "hooks": [
    {
      "event": "pre_tool_use",
      "matcher": "^execute$",
      "command": "node .deepagents/hooks/check-command.mjs",
      "timeoutMs": 30000,
      "priority": 0
    }
  ]
}
```

支持的事件：

- `pre_tool_use`
- `post_tool_use`
- `post_tool_use_failure`
- `before_model_request`
- `after_model_request`

hook command 会收到 JSON stdin。退出码语义：

- `0`：允许继续。
- `2`：拒绝工具调用。

stdout 如果输出 JSON，可返回：

```json
{
  "modifiedArgs": {},
  "replacementResult": "blocked by hook"
}
```

用户级审批 store 路径：

```text
~/.deepagents/approvals.json
```

可以通过 `/approvals` 查看当前 workspace 记录。当前 Zed/ACP 的 `Always allow` / `Always reject` 仍由 `deepagents-acp` 在 session 内部缓存；`approvals.json` 是为后续接入持久化权限回调预留的稳定落点。项目级 `permissions.deniedPaths` 仍然优先于用户级 allow。
