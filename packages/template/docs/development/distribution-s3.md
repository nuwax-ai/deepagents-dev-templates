# Distribution via MinIO / S3

本文档记录把 `deepagents-dev-templates` 的所有产物（压缩包、版本/平台元数据、安装/升级/卸载脚本、manifest）发布到 MinIO / S3 桶的约定，让 nuwaclaw 引擎可以按需拉取。

本地安装/升级/卸载/回滚流程见 [Package Install Lifecycle](./package-install-lifecycle.md)；nuwaclaw 引擎契约见 [nuwaclaw Engine Integration](./nuwaclaw-engine-integration.md)。

## 为什么用 MinIO / S3

- 制品（`tgz` / `nuwax-tar.gz` / `nuwax-zip`）体积在百 MB 量级，自带生产 `node_modules`，不适合走 npm registry 或 git lfs。
- 平台侧希望"按引擎 id + 版本号"寻址，HTTP GET 即可拉取——S3 的扁平键名 + CDN 缓存天然适配。
- MinIO 与 S3 API 兼容，本地开发可以跑 `mc` / `aws s3` 指向内网 MinIO；生产发布到真正的 S3（如 `s3.nuwax.com`）。
- 把 `install.sh` / `upgrade.sh` / `uninstall.sh` / `publish-s3.sh` / `release.sh` 跟制品一起放进同一个版本目录，云端电脑安装时不需要先从仓库拉脚本。

## 桶布局

默认桶：`nuwax-packages`（可通过 `NUWAX_S3_BUCKET` 覆盖）。所有路径都在 `.nuwax-agent/distribution.json` 里声明，发布脚本按这份声明推送。

```text
s3://nuwax-packages/
└── agent-engines/
    └── deepagents-app/                                  # engineId 维度
        ├── latest.json                                  # 当前稳定版指针
        ├── channels/
        │   ├── stable.json                              # → { version: "0.2.1", ... }
        │   └── beta.json                                # → { version: "0.3.0-rc.1", ... }
        ├── install-from-s3.sh                           # 覆盖发布的引导器（每次 release 重写）
        └── versions/
            └── 0.2.1/                                   # 一次发布对应一个版本目录
                ├── artifacts/
                │   ├── deepagents-dev-templates-0.2.1.tgz
                │   ├── deepagents-dev-templates-0.2.1-nuwax.tar.gz
                │   └── deepagents-dev-templates-0.2.1-nuwax.zip
                ├── metadata/
                │   ├── .version.json
                │   ├── .platform.json
                │   ├── package-checksums.json
                │   └── agent-package.release.json
                ├── scripts/
                │   ├── install.sh
                │   ├── upgrade.sh
                │   ├── uninstall.sh
                │   ├── package.sh
                │   ├── validate-package.sh
                │   ├── publish-s3.sh
                │   ├── release.sh
                │   ├── s3-fetch.sh
                │   └── install-from-s3.sh
                └── manifests/
                    ├── agent-package.json
                    ├── template.manifest.json
                    └── .nuwax-agent/
                        ├── package.config.json
                        ├── lifecycle.json
                        ├── placeholders.json
                        ├── panel.config.json
                        ├── sandbox-profiles.json
                        ├── capability-sources.json
                        ├── cloud-debug.profile.json
                        ├── debug.agent_servers.example.json
                        ├── rcoder.chat.agent_servers.example.json
                        ├── agent.spec.example.json
                        └── distribution.json              # 描述这次发布的 manifest 自身
```

`agent-engines/deepagents-app/latest.json` 与 `channels/stable.json` 都指向稳定版；只有 `channels/beta.json` 指向预发布版。`latest.json` 只在 `channel=stable` 发布时更新。

## 指针（pointer）文件

```json
// agent-engines/deepagents-app/channels/stable.json
{
  "schema": "nuwax.agent.channel.v1",
  "channel": "stable",
  "engineId": "deepagents-app",
  "packageName": "deepagents-dev-templates",
  "version": "0.2.1",
  "gitSha": "196ff52...",
  "releasedAt": "2026-06-08T07:00:00Z",
  "artifactBase": "agent-engines/deepagents-app/versions/0.2.1/artifacts/",
  "versionJsonPath": "agent-engines/deepagents-app/versions/0.2.1/metadata/.version.json"
}
```

nuwaclaw 拉取的典型流程：

1. 拉 `agent-engines/deepagents-app/latest.json`，得 `version="0.2.1"`。
2. 拉 `agent-engines/deepagents-app/versions/0.2.1/metadata/.version.json`，校验 sha256 与 `package-checksums.json` 一致。
3. 下载 `agent-engines/deepagents-app/versions/0.2.1/artifacts/deepagents-dev-templates-0.2.1-nuwax.zip`。
4. 从 `agent-engines/deepagents-app/versions/0.2.1/scripts/install.sh` 拉安装脚本（保证跟制品是同一版本），然后 `bash install.sh --artifact ...`。

## tag → channel 规则

发布入口读 git tag 自动判定 channel，不依赖外部传参。

| Tag 形式 | Version | Channel | 触发效果 |
| --- | --- | --- | --- |
| `v0.2.1` | `0.2.1` | `stable` | 上传到 `versions/0.2.1/`，重写 `latest.json` + `channels/stable.json` |
| `v0.3.0-rc.1` | `0.3.0-rc.1` | `beta` | 上传到 `versions/0.3.0-rc.1/`，只重写 `channels/beta.json`，**不**碰 `latest.json` |
| `v0.3.0-beta.2` | `0.3.0-beta.2` | `beta` | 同上 |
| `v0.3.0-alpha.1` | `0.3.0-alpha.1` | `beta` | 同上（`alpha` 也归 beta channel，避免另起一个 `alpha.json`） |

判定规则由 `scripts/publish-s3.sh` 与 `scripts/release.sh` 共同实现：

```text
version 形如 \d+\.\d+\.\d+              → channel = "stable"
version 含 "-"（预发布后缀）             → channel = "beta"
```

可以用 `--channel` 显式覆盖，但默认行为是上面的自动判定。

## release.sh 用法

`scripts/release.sh` 把"打 tag → 重打包 → 推 S3"三步串成一条命令。脚本本身**不**改 `package.json` / `agent-package.json` 的版本号——这两步要在 tag 之前手动做好。

```bash
# 1) 改版本号
$EDITOR package.json agent-package.json        # 都改成 0.3.0-rc.1
git add -p && git commit -m "chore(release): bump 0.3.0-rc.1"

# 2) 打 tag
git tag -a v0.3.0-rc.1 -m "Release candidate 1 for 0.3.0"

# 3) 一条命令跑完
bash scripts/release.sh v0.3.0-rc.1
```

`release.sh` 内部步骤：

1. 检查 `refs/tags/<tag>` 存在。
2. 校验 `package.json.version == agent-package.json.version == <tag 去掉 v>`，不一致直接退出。
3. 校验工作树干净（`git diff --quiet HEAD`），可用 `--allow-dirty` 绕过。
4. 跑 `scripts/package.sh --format all`（可用 `--skip-package` 跳过）。
5. 跑 `scripts/publish-s3.sh --from-tag <tag>`（可用 `--skip-publish` 跳过）。
6. `--dry-run` 会把 `--dry-run` 透传给 `package.sh` / `publish-s3.sh`，只打印计划、不真传 S3。

### 常见组合

```bash
# 稳定版
bash scripts/release.sh v0.2.1

# 预发布版（rc / beta / alpha）
bash scripts/release.sh v0.3.0-rc.1

# 只重打包、暂不传 S3
bash scripts/release.sh v0.3.0-rc.1 --skip-publish

# 仅打印上传计划、不真传
bash scripts/release.sh v0.3.0-rc.1 --dry-run

# 工作树有未提交改动也要发
bash scripts/release.sh v0.3.0-rc.1 --allow-dirty
```

## publish-s3.sh 用法

`scripts/publish-s3.sh` 是发布器本体，`release.sh` 是它的"前端"。需要细粒度控制时直接调它：

```bash
# 显式指定版本
bash scripts/publish-s3.sh --version 0.2.1

# 从 tag 读版本（与 release.sh 行为一致）
bash scripts/publish-s3.sh --from-tag v0.3.0-rc.1

# 强制指定 channel（覆盖自动判定）
bash scripts/publish-s3.sh --from-tag v0.3.0-rc.1 --channel beta

# 不更新 latest.json / channels/*.json（只传制品）
bash scripts/publish-s3.sh --version 0.2.1 --skip-pointers

# 推完先清掉同版本目录再重传
bash scripts/publish-s3.sh --version 0.2.1 --prune

# 只打印命令
bash scripts/publish-s3.sh --from-tag v0.3.0-rc.1 --dry-run
```

### 凭证与端点

发布脚本调用 `aws s3 cp ... --endpoint-url "$NUWAX_S3_ENDPOINT"`，所以只要本地有 `aws` CLI + 凭证即可，不需要额外 SDK。

`publish-s3.sh` **不**加载 `.env`——它假定调用方（CI workflow 或本地手动 export）已经把 env 注入好。如果只想在本地试跑一次，可手动 export 或 `set -a; source .env; set +a`。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NUWAX_S3_ENDPOINT` | `https://s3.nuwax.com:9443` | MinIO / S3 endpoint URL |
| `NUWAX_S3_REGION` | `us-east-1` | region |
| `NUWAX_S3_BUCKET` | `nuwax-packages` | 桶名（nuwax 平台共享的"安装包"桶） |
| `NUWAX_S3_ACCESS_KEY_ID` / `NUWAX_S3_SECRET_ACCESS_KEY` | — | 凭证；脚本会映射到 `AWS_*` 给 `aws s3 cp` 用 |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | 也能直接用（优先于 `NUWAX_S3_*`） |

### 本地用 MinIO 调试

```bash
# 启一个本地 MinIO（如果还没起）
docker run -d --name minio \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  quay.io/minio/minio server /data --console-address ":9001"

# 创建桶
aws --endpoint-url http://localhost:9000 s3 mb s3://nuwax-packages

# 准备凭证
export NUWAX_S3_ENDPOINT=http://localhost:9000
export NUWAX_S3_BUCKET=nuwax-packages
export NUWAX_S3_ACCESS_KEY_ID=minioadmin
export NUWAX_S3_SECRET_ACCESS_KEY=minioadmin

# 试一次 dry-run
bash scripts/publish-s3.sh --from-tag v0.2.1 --dry-run

# 真传
bash scripts/publish-s3.sh --from-tag v0.2.1
```

## Install from S3

发布到桶之后，云端电脑可以在不 git clone 仓库、不下载本地 zip 的情况下直接装新版。

### 一行起跑（最常用）

云端电脑上 export 凭证，然后一行拉起引导器：

```bash
# 由 nuwax 平台在 rcoder 启动时注入（或操作员 export）
export NUWAX_S3_ENDPOINT=https://s3.nuwax.com:9443
export NUWAX_S3_BUCKET=nuwax-packages
export NUWAX_S3_ACCESS_KEY_ID=...            # 来自 nuwax 平台 / .env
export NUWAX_S3_SECRET_ACCESS_KEY=...

bash <(curl -fsSL $NUWAX_S3_ENDPOINT/$NUWAX_S3_BUCKET/agent-engines/deepagents-app/install-from-s3.sh) \
  --channel stable \
  --install-root /opt/nuwax/deepagents-template
```

> 上面 4 个变量名是 GitHub Actions secrets 的 key（也是 `.env` 里的 key）；真实值不会写进文档原文。rcoder 装机时由 nuwax 平台注入，云端电脑本地 shell 看不到明文。

引导器会做：

1. `aws s3 cp s3://.../channels/$CHANNEL.json -` 读 pointer 拿 version
2. `aws s3 cp s3://.../versions/<v>/scripts/{s3-fetch.sh,install.sh} /tmp/`
3. `exec bash /tmp/install.sh --from-bucket --channel stable --install-root ...`

### `install.sh --from-bucket` 单独用

如果 `install.sh` 已经在云端电脑上了（之前的 release 推到 `versions/<v>/scripts/install.sh`），可以省掉引导器直接调：

```bash
bash scripts/install.sh --from-bucket --channel stable \
  --install-root /opt/nuwax/deepagents-template [--force]
```

`--from-bucket` 模式：

- 自动 source `s3-fetch.sh`、加载 `.env`（如存在）、拉 `channels/<channel>.json`、下载 `nuwax-zip`、校验 sha256，再走 `install.sh` 原生安装流程。
- 与 `--artifact <本地>` 互斥。

### `upgrade.sh --from-bucket`

```bash
# 升到当前 stable
bash scripts/upgrade.sh --from-bucket --install-root /opt/nuwax/deepagents-template

# 切到 beta 通道
bash scripts/upgrade.sh --from-bucket --channel beta --install-root /opt/nuwax/deepagents-template

# 显式指定目标版本（不走 channel 解析）
bash scripts/upgrade.sh --from-bucket --target-version 0.3.0-rc.1 \
  --install-root /opt/nuwax/deepagents-template
```

`upgrade.sh --from-bucket` 会读 `$INSTALL_ROOT/.nuwax-agent/install-state.json` 拿当前版本，**目标版本 == 当前版本时直接拒绝**（exit 0 + 提示信息），避免无意义重装。

## 凭证：`.env` vs GitHub Actions secrets

发布 / 安装走 MinIO 需要的凭证通过两套等价通道注入，**不**进仓库。

### 本地开发：`.env`

`packages/template/.env` 已经被 `.gitignore` 覆盖（line 8-9），本地写真实值不会进 git。`.env.example` 里只放空模板：

```bash
# --- MinIO / S3 Distribution ---
NUWAX_S3_ENDPOINT=
NUWAX_S3_REGION=us-east-1
NUWAX_S3_BUCKET=
NUWAX_S3_ACCESS_KEY_ID=
NUWAX_S3_SECRET_ACCESS_KEY=
NUWAX_S3_NO_VERIFY_SSL=0
```

`install.sh` / `upgrade.sh` / `install-from-s3.sh` 启动时会 `source .env`（不存在就直接 return），把变量注入当前 shell。`publish-s3.sh` 不 source（用户明确"打包走 CI"），但本机手测时手动 export 或 `set -a; source .env; set +a` 即可。

### CI：GitHub Actions secrets

`release.sh` 在 `.github/workflows/release.yml` 里被 tag 推送触发，env 通过 secrets 注入。**GH Actions runner 必须能路由到 `s3.nuwax.com:9443`**——如果内网不通要换成自托管 runner。

需要配的 secrets（`gh secret set` 命令）：

```bash
# Production MinIO
gh secret set NUWAX_S3_ENDPOINT         --body "https://s3.nuwax.com:9443"
gh secret set NUWAX_S3_REGION           --body "us-east-1"
gh secret set NUWAX_S3_BUCKET           --body "nuwax-packages"
gh secret set NUWAX_S3_ACCESS_KEY_ID    --body "packages-uploader"
gh secret set NUWAX_S3_SECRET_ACCESS_KEY --body "..."
```

`packages-uploader` 账号只对 `nuwax-packages` 桶有写权限；不可删 / 不可改其他包目录。

workflow 里的 env 注入示例（见 `.github/workflows/release.yml`）：

```yaml
env:
  NUWAX_S3_ENDPOINT: ${{ secrets.NUWAX_S3_ENDPOINT }}
  NUWAX_S3_REGION: ${{ secrets.NUWAX_S3_REGION }}
  NUWAX_S3_BUCKET: ${{ secrets.NUWAX_S3_BUCKET }}
  NUWAX_S3_ACCESS_KEY_ID: ${{ secrets.NUWAX_S3_ACCESS_KEY_ID }}
  NUWAX_S3_SECRET_ACCESS_KEY: ${{ secrets.NUWAX_S3_SECRET_ACCESS_KEY }}
```

`publish-s3.sh` 内部会把 `NUWAX_S3_*` 映射到 `AWS_*` 再调 `aws s3 cp`，所以 secrets 用 `NUWAX_S3_*` 命名时 GH Actions 的 secrets 掩码 / 不进日志行为也正常。

## nuwaclaw 拉取端约定

nuwaclaw 端读 `agent-engines/deepagents-app/channels/stable.json` 拿到当前稳定版，然后走 `agent-engines/deepagents-app/versions/<version>/scripts/install.sh` 启动本地安装。`latest.json` 作为兜底指针，nuwaclaw 启动时如果 channels 文件暂时不可达就回退到 `latest.json`。

文件 / 目录布局由 `.nuwax-agent/distribution.json` 的 `consume` 段描述：

```json
"consume": {
  "discoveryEndpoint": "agent-engines/deepagents-app/latest.json",
  "channelEndpoints": {
    "stable": "agent-engines/deepagents-app/channels/stable.json",
    "beta":   "agent-engines/deepagents-app/channels/beta.json"
  },
  "versionEndpointTemplate": "agent-engines/deepagents-app/versions/{version}/metadata/.version.json",
  "artifactBaseTemplate":   "agent-engines/deepagents-app/versions/{version}/artifacts/",
  "scriptBaseTemplate":      "agent-engines/deepagents-app/versions/{version}/scripts/",
  "manifestBaseTemplate":    "agent-engines/deepagents-app/versions/{version}/manifests/"
}
```

这一段同时也会被推到 S3 上的 `manifests/.nuwax-agent/distribution.json`，nuwaclaw 拿到任何一份都能反推整套布局。

## 校验产物完整性

每次发布后建议跑一遍：

```bash
# 1) 本地：解 zip 后用 validate-package.sh 校验
bash scripts/validate-package.sh \
  --artifact dist-packages/deepagents-dev-templates-<version>-nuwax.zip \
  --checksums dist-packages/package-checksums.json \
  --require-node-modules

# 2) 远端：拉 S3 上的 checksums，对比本地 sha256
aws s3 cp s3://nuwax-packages/agent-engines/deepagents-app/versions/<version>/metadata/package-checksums.json /tmp/
diff <(jq -S '.artifacts' dist-packages/package-checksums.json) \
     <(jq -S '.artifacts' /tmp/package-checksums.json)
```

## CI 集成

`.github/workflows/release.yml` 是 tag 驱动的发布入口，**直接采用本仓库的实现即可**，不必自写。配 secrets 用 `gh secret set`：

```bash
gh secret set NUWAX_S3_ENDPOINT          --body "https://s3.nuwax.com:9443"
gh secret set NUWAX_S3_REGION            --body "us-east-1"
gh secret set NUWAX_S3_BUCKET            --body "nuwax-packages"
gh secret set NUWAX_S3_ACCESS_KEY_ID     --body "packages-uploader"
gh secret set NUWAX_S3_SECRET_ACCESS_KEY --body "..."
```

`packages-uploader` 账号只对 `nuwax-packages` 桶有写权限；不可删 / 不可改其他包目录。

CI 流程触发条件：`git push --tags v0.2.1`（或 `v0.3.0-rc.1`）。workflow 跑：

1. `actions/checkout@v4`（`fetch-depth: 0`，拿完整 tag 历史）
2. `actions/setup-node@v4`（Node 20）
3. `apt-get install -y awscli jq` + `npm ci`
4. 把上面 5 个 secrets 注入 env 跑 `bash scripts/release.sh "${GITHUB_REF_NAME}"`

**前提**：GH Actions runner 必须能路由到 `s3.nuwax.com:9443`。如果 nuwax 内部 DNS 在公网跑不通，CI 这条路要换成自托管 runner；本地开发不受影响。
