# Scripts

本项目的构建、打包与本地范例运行脚本。全部为 **纯 Node `.mjs`**，可在 Windows PowerShell、macOS 与 Linux 下运行。

## Version sync

以 `package.json` 顶层 `version` 为权威源，同步到发布相关的派生元数据（`.nuwax-agent/agent-package.json`、`config/flow-agent.config.json`），避免手动改一处忘一处导致压缩包版本错位。**不触碰**依赖版本、引擎要求、框架版本。

| Script | npm 命令 | 说明 |
|--------|----------|------|
| `sync-version.mjs` | `pnpm run version:sync` | 执行同步（写盘） |
| | `pnpm run version:preview` | `--dry-run`，只预览不写 |
| | `pnpm run version:check` | `--check`，不一致则退出 1（CI 守卫） |

`package` / `package:all` / `package:platforms` 均已在前置串联 `version:check` —— 版本不一致时直接中断，不会产出错版本压缩包。

## Build & Bundle

| Script | npm 命令 | 说明 |
|--------|----------|------|
| `lib/bundle.mjs` | `pnpm run bundle` | esbuild 打包为 `dist/bundle.mjs` |
| `package.mjs` | `pnpm run package` | npm tgz + Nuwax tar/zip |
| `package-platforms.mjs` | `pnpm run package:platforms` | 按平台归档 + `platforms.json` |
| `validate-package.mjs` | `pnpm run validate:package` | 校验压缩包完整性 |

## 本地范例（example）

| Script | npm 命令 | 说明 |
|--------|----------|------|
| `run-example.mjs` | `pnpm run example <name> [args]` | 本地跑精选范例；`pnpm example --list` |
| `lib/example-registry.mjs` | — | 精选范例别名注册表 |

**精选范例别名**：`travel` / `pm` / `review` / `research`（见 `lib/example-registry.mjs`）。

## 真实调试（flow-debugger）

端到端验证已迁移到 **flow-debugger** skill（`packages/dev-agent-flow/skills/flow-debugger`）——走平台真实链路（非本地 rcoder-cli 模拟），执行出现在用户 agent-dev 预览会话。原来的本地 `pnpm smoke`（rcoder-cli）已移除。

| 操作 | 命令 |
|------|------|
| 发消息真实执行 + 通过/失败判定 | `flow-debugger/scripts/debug.sh --message "..." --expect-tool <工具名>` |
| 新建/获取/取消会话 | `flow-debugger/scripts/session.sh new\|current\|cancel` |
| 权限审批响应 | `flow-debugger/scripts/approve.sh --tool-id ... --option-id ... --outcome selected\|cancelled` |
| runtime 日志分析 | `flow-debugger/scripts/analyze-logs.sh` |

> runtime 仍保留两个可观测/加速开关（非 smoke 专属，flow-debugger 复用）：
> - `SMOKE_TOOL_TRACE=1`（session-trace 输出 `tool invoke start/done/failed` 摘要，供 analyze-logs 解析工具调用）
> - `AGENT_LIGHT=1`（跳过 MCP 加载，轻量验证）

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
| `lib/example-registry.mjs` | 精选范例别名注册表 |
