# Rcoder 云端调试

本文档记录 rcoder 云端电脑路径，用于在真实 ACP 客户端环境中测试打包后的 agent。

## 打包

rcoder 使用 Nuwax 的 tar/zip 制品，因为制品里已经捆绑了生产环境的 `node_modules`，在云端电脑上可以跳过 `npm install` 直接启动。

```bash
bash scripts/package.sh --format all
bash scripts/validate-package.sh --artifact dist-packages/deepagents-dev-templates-<version>-nuwax.zip --require-node-modules
```

预期产物：

```text
dist-packages/deepagents-dev-templates-<version>-nuwax.tar.gz
dist-packages/deepagents-dev-templates-<version>-nuwax.zip
dist-packages/deepagents-dev-templates-<version>.version.json
dist-packages/deepagents-dev-templates-<version>.platform.json
dist-packages/package-checksums.json
```

## 安装

```bash
bash scripts/install.sh \
  --artifact dist-packages/deepagents-dev-templates-<version>-nuwax.zip \
  --install-root /opt/nuwax/deepagents-template \
  --force
```

当制品内已经包含 `node_modules` 时，安装器会打印：

```text
Using bundled node_modules; skipping npm install.
```

## 聊天侧 ACP 配置

聊天端需要下发一个等价于 Zed ACP 格式的 `agent_servers` 配置。安装后使用绝对路径，OpenAI 兼容的模型相关设置保留为默认。

```json
{
  "agent_servers": {
    "deepagents-template": {
      "type": "custom",
      "command": "node",
      "args": [
        "/opt/nuwax/deepagents-template/dist/index.js"
      ],
      "env": {
        "OPENAI_MODEL": "mimo-v2.5-pro",
        "OPENAI_BASE_URL": "https://your-openai-compatible-endpoint/v1",
        "OPENAI_API_KEY": "${SECRET_OPENAI_API_KEY}",
        "LOG_LEVEL": "debug",
        "LOG_DIR": "/opt/nuwax/deepagents-template/logs"
      }
    }
  }
}
```

模板原型位于：

```text
.nuwax-agent/rcoder.chat.agent_servers.example.json
```

### 为什么这些字段不需要传

下面的字段在示例中被省略了，因为模板/平台/运行时已经有合理默认值；只有当默认值与目标环境不符时才需要显式覆盖。

| 字段 | 默认行为 | 何时需要显式传入 |
| --- | --- | --- |
| `--config <path>` | 加载 `<package>/config/app-agent.config.json` | 需要切换到自定义配置文件时 |
| `LLM_PROVIDER` | `anthropic`（直连 Anthropic 协议） | 端点只支持 OpenAI 协议时设为 `openai` |
| `MAX_TOKENS` | `16384` | 需要调整单次输出上限时 |
| `LOG_LEVEL` | `info` | 需要排障时设为 `debug` |
| `LOG_DIR` | `<package>/logs` | 需要把日志写到自定义目录时 |
| `DEEPAGENTS_SANDBOX_PROFILE` | `custom`（沿用 `permissions.deniedPaths`） | 想要放开工作区写权限时设为 `workspace-write` |

### 规则

- 不要在同一个配置里同时下发 OpenAI 与 Anthropic 的凭证。
- `OPENAI_API_KEY`（以及 `ANTHROPIC_API_KEY` 等敏感字段）必须放在云端环境变量或密钥占位符中，绝不能写入仓库。
- 打包后的 rcoder 启动入口使用 `dist/index.js`，不要使用 `tsx src/index.ts`。
- 如果端点是 OpenAI 协议（不兼容 Anthropic），请在 `env` 里把 `LLM_PROVIDER` 显式设为 `openai`。
