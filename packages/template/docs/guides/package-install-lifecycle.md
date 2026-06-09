# Package Install Lifecycle

This document records the package, install, upgrade, and uninstall
lifecycle for distributing `packages/template` as a Nuwax Agent engine.

The initial declarative skeleton now lives in `.nuwax-agent/package.config.json`,
`.nuwax-agent/placeholders.json`, and `.nuwax-agent/lifecycle.json`. A local
executable lifecycle also exists in `scripts/package.sh`, `scripts/install.sh`,
`scripts/upgrade.sh`, `scripts/uninstall.sh`, and `scripts/validate-package.sh`.
Production platform installer validation is still planned work.

## Goals

- Generate npm-compatible and Nuwax-compatible artifacts.
- Produce version and platform JSON files for installation platforms.
- Keep development/debug configuration in `.nuwax-agent`.
- Support install, upgrade, rollback, and uninstall.
- Prevent real secrets from entering source control or packaged artifacts.

## Key Decisions

| Decision | Choice |
|---|---|
| Dependency strategy | Nuwax tar/zip bundle production `node_modules`; install skips `npm install` when bundled dependencies exist. |
| Version source | `package.json.version` and `agent-package.json.version` must match before packaging. |
| npm artifact | `.tgz` from `npm pack`; kind is `npm-tgz`. |
| Nuwax tar artifact | `.tar.gz` from a controlled staging directory; kind is `nuwax-tar`. |
| Nuwax zip artifact | `.zip` from the same staging directory; kind is `nuwax-zip`. |
| Config defaults | `${VERSION_DIR}/.nuwax-agent/` is read-only version default config. |
| Mutable config | `${SHARED_DIR}/.nuwax-agent/` is panel/user mutable config. |
| Upgrade behavior | Upgrade never overwrites shared config. |
| Current pointer | macOS/Linux prefer symlink; Windows or symlink failure uses `current.json`. |
| Smoke tests | Must not depend on real LLM calls. |

## Package Outputs

Default output directory:

```text
packages/template/dist-packages/
```

Expected files:

```text
deepagents-dev-templates-<version>.tgz
deepagents-dev-templates-<version>-nuwax.tar.gz
deepagents-dev-templates-<version>-nuwax.zip
deepagents-dev-templates-<version>.version.json
deepagents-dev-templates-<version>.platform.json
agent-package.release.json
package-checksums.json
```

The version and platform JSON files are emitted as sidecars and copied into the
Nuwax tar/zip artifacts for offline auditing.

## Script Surface

Packaging entry:

```text
scripts/package.sh
```

Install / upgrade / uninstall:

```text
scripts/install.sh
scripts/upgrade.sh
scripts/uninstall.sh
```

Validation:

```text
scripts/validate-package.sh
```

`package.sh` should support:

```bash
bash scripts/package.sh --format all
bash scripts/package.sh --format npm-tgz
bash scripts/package.sh --format tar
bash scripts/package.sh --format zip
bash scripts/package.sh --skip-tests
bash scripts/package.sh --out dist-packages
bash scripts/package.sh --format all --no-bundle-node-modules
```

## Packaging Flow

1. Validate `package.json.version === agent-package.json.version`.
2. Clean and create staging directory.
3. Run build.
4. Run tests by default.
5. Copy runtime files, dist, config, prompts, skills, docs, scripts, manifests, and `.nuwax-agent` defaults to staging.
6. Install production dependencies into staging `node_modules` for Nuwax tar/zip unless `--no-bundle-node-modules` is used.
7. Run secret scan.
8. Generate npm `.tgz`.
9. Generate Nuwax `.tar.gz`.
10. Generate Nuwax `.zip`.
11. Compute sha256 and size for every artifact.
12. Generate `.version.json`, `.platform.json`, `agent-package.release.json`, and `package-checksums.json`.

## Version JSON

File:

```text
deepagents-dev-templates-<version>.version.json
```

Schema:

```json
{
  "schema": "nuwax.agent.version.v1",
  "name": "deepagents-dev-templates",
  "agentName": "deepagents-app-agent",
  "version": "<version>",
  "engine": "deepagents-app",
  "generatedAt": "2026-06-06T00:00:00.000Z",
  "artifacts": [
    { "kind": "npm-tgz", "file": "deepagents-dev-templates-<version>.tgz", "sha256": "...", "size": 0 },
    { "kind": "nuwax-tar", "file": "deepagents-dev-templates-<version>-nuwax.tar.gz", "sha256": "...", "size": 0 },
    { "kind": "nuwax-zip", "file": "deepagents-dev-templates-<version>-nuwax.zip", "sha256": "...", "size": 0 }
  ],
  "runtime": {
    "node": ">=20.0.0",
    "entry": "dist/index.js"
  }
}
```

## Platform JSON

File:

```text
deepagents-dev-templates-<version>.platform.json
```

Schema:

```json
{
  "schema": "nuwax.agent.platform.v1",
  "engine": "deepagents-app",
  "version": "<version>",
  "artifactType": "universal-node",
  "supportedPlatforms": [
    { "os": "darwin", "arch": ["arm64", "x64"] },
    { "os": "linux", "arch": ["arm64", "x64"] },
    { "os": "win32", "arch": ["x64"] }
  ],
  "install": {
    "entry": "dist/index.js",
    "command": "node",
    "args": ["${INSTALL_ROOT}/current/dist/index.js"],
    "workingDirectory": "${WORKSPACE_ROOT}",
    "dependencyInstall": "npm install --omit=dev"
  },
  "launchProfiles": {
    "cloud-debug": {
      "type": "custom",
      "command": "node",
      "args": ["${INSTALL_ROOT}/current/dist/index.js"],
      "env": {
        "LLM_PROVIDER": "openai",
        "OPENAI_MODEL": "${OPENAI_MODEL}",
        "OPENAI_BASE_URL": "${OPENAI_BASE_URL}",
        "OPENAI_API_KEY": "${SECRET_OPENAI_API_KEY}",
        "MAX_TOKENS": "${MAX_TOKENS}",
        "LOG_LEVEL": "${LOG_LEVEL}",
        "LOG_DIR": "${LOG_DIR}"
      }
    }
  }
}
```

## Install

### From local artifact

```bash
bash scripts/install.sh \
  --artifact dist-packages/deepagents-dev-templates-<version>-nuwax.zip \
  --install-root /opt/nuwax/deepagents-template
```

Install layout:

```text
${INSTALL_ROOT}/deepagents-dev-templates/<version>/
${INSTALL_ROOT}/deepagents-dev-templates/current
${INSTALL_ROOT}/deepagents-dev-templates/current.json
${INSTALL_ROOT}/deepagents-dev-templates/shared/
```

Install flow:

1. Validate artifact checksum.
2. Extract into version directory.
3. Run secret scan.
4. Check Node.js `>=20`.
5. Use bundled `node_modules` when present; otherwise run `npm install --omit=dev`.
6. Initialize `${SHARED_DIR}/.nuwax-agent/` from version defaults only if missing.
7. Render non-secret placeholders: `INSTALL_ROOT`, `WORKSPACE_ROOT`, `LOG_DIR`.
8. Create `current` symlink; if it fails, write `current.json`.
9. Write `install-state.json`.
10. Run smoke tests.

Install state:

```json
{
  "schema": "nuwax.agent.install-state.v1",
  "name": "deepagents-dev-templates",
  "currentVersion": "<version>",
  "installedVersions": ["<version>"],
  "currentPath": "${INSTALL_ROOT}/deepagents-dev-templates/current",
  "sharedPath": "${INSTALL_ROOT}/deepagents-dev-templates/shared",
  "installedAt": "2026-06-06T00:00:00.000Z"
}
```

### From S3 bucket

```bash
bash scripts/install.sh \
  --from-bucket \
  --channel stable \
  --install-root /opt/nuwax/deepagents-template
```

S3 模式：

- 自动 source `scripts/s3-fetch.sh`，加载 `.env`（如存在）。
- 拉 `agent-engines/deepagents-app/channels/<channel>.json` 拿 version。
- 拉 `versions/<v>/artifacts/deepagents-dev-templates-<v>-nuwax.zip`，校验 sha256 后走本地安装流程。
- 与 `--artifact <本地>` 互斥。

**云端电脑一行起跑**（不走 git clone）：

```bash
bash <(curl -fsSL https://s3.nuwax.com:9443/nuwax-packages/agent-engines/deepagents-app/install-from-s3.sh) \
  --channel stable \
  --install-root /opt/nuwax/deepagents-template
```

凭证 `NUWAX_S3_*` 需提前 export（`install-from-s3.sh` 引导器会校验）。详细桶布局 / 凭证模型见 [Distribution via MinIO/S3](./distribution-s3.md)。

## Upgrade

### From local artifact

```bash
bash scripts/upgrade.sh \
  --artifact dist-packages/deepagents-dev-templates-<new-version>-nuwax.zip \
  --install-root /opt/nuwax/deepagents-template
```

### From S3 bucket

```bash
# 升到当前 stable
bash scripts/upgrade.sh --from-bucket --install-root /opt/nuwax/deepagents-template

# 切到 beta 通道
bash scripts/upgrade.sh --from-bucket --channel beta --install-root /opt/nuwax/deepagents-template

# 显式指定目标版本
bash scripts/upgrade.sh --from-bucket --target-version 0.3.0-rc.1 \
  --install-root /opt/nuwax/deepagents-template
```

S3 模式：

- 读 `$INSTALL_ROOT/.nuwax-agent/install-state.json` 拿 current version。
- 解析 target version（`--target-version` 优先，否则 `s3_resolve_version`）。
- `current == target` 直接拒绝并提示（避免无意义重装；如需重装请用 `--target-version` 显式不同版本）。
- 拉新 artifact + 校验 sha256 + preserve user data + swap 目录。

### Rollback

```bash
# 从 S3 拉到的版本升级失败
bash scripts/upgrade.sh --rollback --install-root /opt/nuwax/deepagents-template
```

回滚逻辑：

- 读 `.nuwax-agent/upgrade-state.json` 的 `backupPath`。
- 把当前（坏掉的）目录改名为 `INSTALL_ROOT.failed-YYYYMMDDHHMMSS`。
- 拷贝 `backupPath` 回 `INSTALL_ROOT`。
- 不需要再传 `--artifact` / `--from-bucket`。

## Uninstall

Default uninstall keeps user data:

```bash
bash scripts/uninstall.sh --install-root <path> --keep-data
```

It deletes:

- Version directories.
- `current`.
- `current.json`.
- Install state.

It keeps:

- `${SHARED_DIR}`.
- Logs.
- User-level `~/.deepagents/workspaces`.

Purge mode:

```bash
bash scripts/uninstall.sh --install-root <path> --purge
bash scripts/uninstall.sh --install-root <path> --purge --purge-runtime-state
```

Only `--purge-runtime-state` may delete user-level runtime state.

## Lifecycle JSON

`.nuwax-agent/lifecycle.json` should declare:

```json
{
  "schema": "nuwax.agent.lifecycle.v1",
  "install": {
    "script": "scripts/install.sh",
    "stateFile": "install-state.json"
  },
  "upgrade": {
    "script": "scripts/upgrade.sh",
    "keepVersions": 2,
    "rollback": true
  },
  "uninstall": {
    "script": "scripts/uninstall.sh",
    "defaultMode": "keep-data",
    "supportsPurge": true
  }
}
```

## Secret Scan

Run secret scan during package, install, and upgrade.

Forbidden:

- Real `OPENAI_API_KEY`.
- Real `ANTHROPIC_API_KEY`.
- Real `PLATFORM_API_TOKEN`.
- `Bearer <token>`.
- `sk-...`.
- `tp-...`.

Allowed:

- `${SECRET_OPENAI_API_KEY}`.
- `${OPENAI_API_KEY}`.
- `<your-api-key>`.
- Environment variable names as strings.

When a secret is detected, report file path and field name, but do not print the
full secret value.

## Smoke Tests

Smoke tests must not call a real LLM:

```bash
node dist/index.js --help
node dist/index.js graph
npm run test:acp-smoke
```

## Acceptance

```bash
npm run build
npm test
npm run graph
bash scripts/package.sh --format all
bash scripts/validate-package.sh --artifact dist-packages/deepagents-dev-templates-<version>-nuwax.zip --require-node-modules
bash scripts/install.sh --artifact dist-packages/deepagents-dev-templates-<version>-nuwax.zip --install-root /tmp/nuwax-agent-test --force
bash scripts/upgrade.sh --artifact dist-packages/deepagents-dev-templates-<version>-nuwax.zip --install-root /tmp/nuwax-agent-test
bash scripts/upgrade.sh --rollback --install-root /tmp/nuwax-agent-test
bash scripts/uninstall.sh --install-root /tmp/nuwax-agent-test --keep-data
```

Acceptance points:

- npm `.tgz`, Nuwax `.tar.gz`, and Nuwax `.zip` are generated.
- `.version.json` and `.platform.json` are generated and included in tar/zip.
- `install-state.json` is written correctly.
- Shared `.nuwax-agent` exists after install and is not overwritten on upgrade.
- Windows/symlink fallback writes `current.json`.
- Upgrade failure does not switch current.
- Keep-data uninstall does not delete shared or runtime state.
- Secret scan blocks real keys and allows placeholders.
