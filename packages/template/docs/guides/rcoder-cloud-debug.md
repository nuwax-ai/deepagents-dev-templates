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

## 从 S3 一键安装

云端电脑（rcoder）通常没有 git checkout，制品都在 MinIO / S3 桶里。`install-from-s3.sh` 引导器会自己拉 channel pointer + install.sh，跑通"零样本起跑"：

```bash
# 由 nuwax 平台在 rcoder 启动时注入（或操作员 export）
export NUWAX_S3_ENDPOINT=https://s3.nuwax.com:9443
export NUWAX_S3_BUCKET=nuwax-packages
export NUWAX_S3_ACCESS_KEY_ID=...            # 来自 nuwax 平台 / .env
export NUWAX_S3_SECRET_ACCESS_KEY=...

bash <(curl -fsSL $NUWAX_S3_ENDPOINT/$NUWAX_S3_BUCKET/agent-engines/deepagents-app-ts-ts/install-from-s3.sh) \
  --channel stable \
  --install-root /opt/nuwax/deepagents-template
```

上面 4 个变量名是 GitHub Actions secrets 的 key，真实值不会出现在文档里。

## 安装

### 从本地制品

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

### 从 S3 桶

```bash
bash scripts/install.sh \
  --from-bucket \
  --channel stable \
  --install-root /opt/nuwax/deepagents-template \
  --force
```

`install.sh` 自动 source `s3-fetch.sh` + 加载 `.env`（如存在），从 `agent-engines/deepagents-app-ts-ts/channels/stable.json` 解析当前 version，下载 `nuwax-zip` 并校验 sha256，再走原生安装流程。

凭证注入（与"从 S3 一键安装"相同）：`NUWAX_S3_*` 这 4 个 env 变量。

## 升级

`scripts/upgrade.sh` 会在保留用户数据的前提下，把当前安装原地替换为新版本制品；如果升级过程中出问题，可以再跑一次 `--rollback` 回到上一个版本。

### 从 S3 桶

```bash
# 升到当前 stable
bash scripts/upgrade.sh \
  --from-bucket \
  --install-root /opt/nuwax/deepagents-template

# 切到 beta 通道
bash scripts/upgrade.sh \
  --from-bucket \
  --channel beta \
  --install-root /opt/nuwax/deepagents-template
```

`upgrade.sh --from-bucket` 读 `$INSTALL_ROOT/.nuwax-agent/install-state.json` 拿当前版本，**目标版本 == 当前版本时直接拒绝**（exit 0 + 提示）。

升级时默认会保留以下内容（写入新版本安装目录）：

- `config/*.local.json`（本地配置覆盖）
- `.env`（API key 等环境变量）
- `logs/**`（历史日志）
- `skills/platform/**`（用户自加的平台技能）

升级器会把当前安装备份到 `$(dirname "$INSTALL_ROOT")/.nuwax-agent-backups/$NAME-YYYYMMDDHHMMSS`，并把"上一个目录"改名保留：

```text
/opt/nuwax/deepagents-template.previous-YYYYMMDDHHMMSS
/opt/nuwax/.nuwax-agent-backups/deepagents-template-YYYYMMDDHHMMSS
```

同时在新的安装目录里写入 `.nuwax-agent/upgrade-state.json`，记录备份路径，便于回滚。

### 回滚

如果升级后发现 agent 起不来，可以一次性回滚到刚被替换的版本：

```bash
bash scripts/upgrade.sh \
  --rollback \
  --install-root /opt/nuwax/deepagents-template
```

> 回滚不需要 `--from-bucket`，因为上一版本的备份已经写在本地 `.nuwax-agent-backups/`，S3 不参与。

回滚逻辑：

- 把当前（坏掉的）目录改名为 `INSTALL_ROOT.failed-YYYYMMDDHHMMSS`，方便事后排查。
- 用 `upgrade-state.json` 里的 `backupPath` 把上一次成功的安装拷回 `INSTALL_ROOT`。
- 不需要再传 `--artifact`。

### 升级注意

- 升级器以"复制-再切目录"方式替换，整个过程不是原子提交。回滚只能在**上一次成功升级的产物**之间切换，多次连续升级后只能回到最近一次。
- 如果新版本修改了 `config/app-agent.config.json` 的字段，`.local.json` 里同名字段会按用户覆盖处理；不冲突的字段会原样保留。
- `skills/builtin/` 是模板自带技能，每次升级都会被新版本覆盖。`skills/platform/` 是用户扩展，升级不会动。

## 卸载

`scripts/uninstall.sh` 默认直接删除安装目录。如果想把"用户数据"（`.env`、本地配置、日志、平台技能）留一份再删除，可以加 `--export` 或 `--keep-data`。

```bash
# 直接删除
bash scripts/uninstall.sh \
  --install-root /opt/nuwax/deepagents-template

# 删除前先打一个 tar.gz 包，默认路径：
#   /opt/nuwax/deepagents-template-uninstall-export-YYYYMMDDHHMMSS.tar.gz
bash scripts/uninstall.sh \
  --install-root /opt/nuwax/deepagents-template \
  --keep-data

# 指定导出包路径
bash scripts/uninstall.sh \
  --install-root /opt/nuwax/deepagents-template \
  --export /opt/nuwax/backup/deepagents-template-snapshot.tar.gz
```

导出包里包含：

- `.env`
- `logs/**`
- `skills/platform/**`
- `.nuwax-agent/**`（含 `install-state.json` / `upgrade-state.json`）
- `config/*.local.json`

模板自带的 `config/app-agent.config.json`、`dist/`、`node_modules/` 等不会进入导出包——这些下次安装时随制品一起恢复。

### 卸载注意

- 脚本不会调用 `systemctl` / `launchd` 之类的服务管理器；如果 rcoder 是用平台 daemon 拉起的，需要先在平台侧停止 `deepagents-template` 服务。
- `--keep-data` 和 `--export` 等价：传 `--export` 时自动按"导出再删除"流程处理；不传则只删目录、不打包。
- 卸载前如果还想升级，先用 `upgrade.sh --rollback` 回滚到上一版本，再决定是继续升级还是卸载；卸载后无法再用回滚。

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

快速渲染安装路径已填好的 ACP 配置：

```bash
bash scripts/render-acp-config.sh --install-root /opt/nuwax/deepagents-template
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
| `LLM_PROVIDER` | 未设置时根据 `OPENAI_*` / `ANTHROPIC_*` 自动推断；配置文件默认 `anthropic` | 两套凭证同时存在、需强制指定协议时显式传入 |
| `MAX_TOKENS` | `16384` | 需要调整单次输出上限时 |
| `LOG_LEVEL` | `info` | 需要排障时设为 `debug` |
| `LOG_DIR` | `<package>/logs` | 需要把日志写到自定义目录时 |
| `DEEPAGENTS_SANDBOX_PROFILE` | `custom`（沿用 `permissions.deniedPaths`） | 想要放开工作区写权限时设为 `workspace-write` |

### 规则

- 不要在同一个配置里同时下发 OpenAI 与 Anthropic 的凭证。
- `OPENAI_API_KEY`（以及 `ANTHROPIC_API_KEY` 等敏感字段）必须放在云端环境变量或密钥占位符中，绝不能写入仓库。
- 打包后的 rcoder 启动入口使用 `dist/index.js`，不要使用 `tsx src/index.ts`。
- OpenAI 兼容端点只需注入 `OPENAI_MODEL` / `OPENAI_BASE_URL` / `OPENAI_API_KEY`，无需再设 `LLM_PROVIDER`；仅当同时存在两套凭证且要强制走 Anthropic 协议时才设 `LLM_PROVIDER=anthropic`。
