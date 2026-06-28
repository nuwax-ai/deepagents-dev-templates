# Scripts

`deepagents-flow-ts` 的构建、打包与冒烟测试脚本。全部为 **纯 Node `.mjs`**，可在 Windows PowerShell、macOS 与 Linux 下运行。

## Version sync

以 `package.json` 顶层 `version` 为权威源，同步到发布相关的派生元数据（`.nuwax-agent/agent-package.json`、`config/flow-agent.config.json`），避免手动改一处忘一处导致制品版本错位。**不触碰**依赖版本、引擎要求、框架版本。

| Script | npm 命令 | 说明 |
|--------|----------|------|
| `sync-version.mjs` | `pnpm run version:sync` | 执行同步（写盘） |
| | `pnpm run version:preview` | `--dry-run`，只预览不写 |
| | `pnpm run version:check` | `--check`，不一致则退出 1（CI 守卫） |

`package` / `package:all` / `package:platforms` 均已在前置串联 `version:check` —— 版本不一致时直接中断，不会产出错版本制品。

## Build & Bundle

| Script | npm 命令 | 说明 |
|--------|----------|------|
| `lib/bundle.mjs` | `pnpm run bundle` | esbuild 打包为 `dist/bundle.mjs` |
| `package.mjs` | `pnpm run package` | npm tgz + Nuwax tar/zip |
| `package-platforms.mjs` | `pnpm run package:platforms` | 按平台归档 + `platforms.json` |
| `validate-package.mjs` | `pnpm run validate:package` | 校验制品完整性 |

## Smoke tests

| Script | npm 命令 | 说明 |
|--------|----------|------|
| `smoke-acp.mjs` | `pnpm run smoke` | 默认 flow（`src/index.ts`，读 `activeFlow`） |
| | `pnpm run smoke -- --example rag` 等 | `--example` 指向各范例短名 |

**模型 env**：`scripts/lib/smoke-env.mjs` 从 `.env` + `config/flow-agent.config.json` 解析 provider/model，过滤 `{MODEL_PROVIDER_*}` 占位符后 `-e` 传给 rcoder-cli（避免 400 Invalid model）。

| Env | 说明 |
|-----|------|
| `SMOKE_PROMPT` | 主路径用户输入 |
| `SMOKE_PROMPT_EDGE` | 可选第二条（边界输入，如「你是？」） |
| `SMOKE_EXPECT_ACTIVE_FLOW` | 与 `activeFlow` 不一致则失败 |
| `SMOKE_DEBUG=1` | 打印解析后的模型 env |

`--entry` 或 `AGENT_ENTRY` 可指定入口；`--debug --dry-run` 可在无 API key 时检查命令。

## Windows 打包工具（可选）

```powershell
pnpm run setup:tools   # Chocolatey 安装 rsync、zip
pnpm run check:tools   # 检测工具是否就绪
```

| 工具 | 用途 | 缺失时 fallback |
|------|------|-----------------|
| `rsync` | staging 复制 | Node `fs.cp` |
| `zip` | Windows `.zip`（最快） | `System32\tar -a`（正斜杠 `-C`）→ PowerShell `Compress-Archive` |
| `gzip` / `tar` | `.tar.gz` / Windows `.zip`（无 `zip` CLI 时） | Node `zlib` + `tar` / PowerShell |

## 共享库

| 路径 | 说明 |
|------|------|
| `lib/bundle.mjs` | esbuild 打包 |
| `lib/staging.mjs` | staging 复制与归档 |
| `lib/tools.mjs` | CLI 工具检测 |
