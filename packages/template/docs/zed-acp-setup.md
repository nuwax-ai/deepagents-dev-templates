# Zed ACP 配置

在 Zed 的 `settings.json` 中注册本模板 agent 时，可以使用下面的配置。

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
        "ANTHROPIC_MODEL": "mimo-v2.5-pro",
        "ANTHROPIC_BASE_URL": "https://token-plan-cn.xiaomimimo.com/anthropic",
        "ANTHROPIC_API_KEY": "<your-api-key>",
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
- Anthropic-compatible gateway 推荐使用 `ANTHROPIC_API_KEY`。如果父进程环境里有旧的 `ANTHROPIC_AUTH_TOKEN`，运行时会在检测到 `ANTHROPIC_API_KEY` 后自动清理它，避免网关收到冲突凭证后返回 401。
- 修改 `settings.json` 后需要重启或 reload Zed。

快速验证：

```bash
ANTHROPIC_MODEL=mimo-v2.5-pro \
ANTHROPIC_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic \
ANTHROPIC_API_KEY=<your-api-key> \
LOG_LEVEL=debug \
LOG_DIR=/absolute/path/to/deepagents-dev-templates/logs \
node --import tsx /absolute/path/to/deepagents-dev-templates/packages/template/src/index.ts \
  --config /absolute/path/to/deepagents-dev-templates/packages/template/config/app-agent.config.json
```

预期启动日志信号：

- `name` 是 `my-scenario-agent`
- `ANTHROPIC_MODEL` 是 Zed settings 中配置的值
- 设置了 `ANTHROPIC_API_KEY` 时，`ANTHROPIC_AUTH_TOKEN` 是 `(unset)`
- 模板配置以 `yolo` 模式加载时，`permissions` 是 `1`
