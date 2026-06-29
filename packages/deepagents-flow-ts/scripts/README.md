# Scripts

`deepagents-flow-ts` 的构建、打包与冒烟测试脚本。全部为 **纯 Node `.mjs`**，可在 Windows PowerShell、macOS 与 Linux 下运行。

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

## Smoke tests

| Script | npm 命令 | 说明 |
|--------|----------|------|
| `smoke-acp.mjs` | `pnpm run smoke` | 默认 flow（`src/index.ts`，读 `activeFlow`） |
| | `pnpm run smoke -- --example <name>` | 范例短名冒烟（见下表） |
| `run-example.mjs` | `pnpm run example <name> [args]` | 本地跑范例（CLI / 交互 / ACP）；`pnpm example --list` |
| `lib/example-registry.mjs` | — | `smoke --example` 与 `pnpm example` 共用别名表 |

**范例别名**（`pnpm example --list` 同步）：

| 别名 | 入口 |
|------|------|
| `rag` | `examples/rag/index.ts` |
| `travel` | `examples/travel-planner/index.ts` |
| `pm` | `examples/project-manager/index.ts` |
| `review` | `examples/human-in-loop/index.ts` |
| `dev-agent` | `examples/dev-agent/index.ts` |
| `research` | `examples/deep-research/index.ts` |

### 模型 env（`lib/smoke-env.mjs`）

与 runtime `config-loader` 对齐；过滤 `{MODEL_PROVIDER_*}` 占位符后 `-e` 传给 rcoder-cli（避免 400 Invalid model）。

`smoke-acp.mjs` 用 `dotenv` **`override:true`** 加载项目 `.env` —— **`.env` 覆盖** NuWaClaw / shell 注入值；未设的键再回落到注入 env。

| 层级 | 规则 |
|------|------|
| 凭证 | `OPENAI_API_KEY` / `ANTHROPIC_*` / `OPENCODE_OPENAI_API_KEY` |
| Provider | `API_PROTOCOL` / `LLM_PROVIDER` > 凭证推断 > `config.model.provider` |
| Model | `OPENAI_MODEL` > `ANTHROPIC_MODEL` > `DEFAULT_MODEL` > `config.model.name` |
| Base URL | `OPENAI_BASE_URL` > `ANTHROPIC_BASE_URL` > `config.model.baseUrl` |
| OPENCODE 兜底 | standard 缺失时用 `OPENCODE_OPENAI_API_KEY` / `OPENCODE_OPENAI_API_BASE` / `OPENCODE_MODEL`（NuWaClaw opencode 下发）；forward 仍发 standard 键 |

本地开发推荐 `cp .env.example .env`；在 NuWaClaw 内若已有 `OPENCODE_*` 或 `API_PROTOCOL` + 单家族 key，可不建 `.env`。

### Smoke 专用 env

| Env | 说明 |
|-----|------|
| `SMOKE_PROMPT` | 主路径用户输入 |
| `SMOKE_PROMPT_EDGE` | 可选第二条（边界输入，如「你是？」） |
| `SMOKE_EXPECT_ACTIVE_FLOW` | 与 `activeFlow` 不一致则 exit 1 |
| `SMOKE_WARN_ACTIVE_FLOW=0` | 关闭 `activeFlow=default` 警告 |
| `SMOKE_TIMEOUT` | rcoder 超时秒数（默认 `150`） |
| `SMOKE_VERBOSE=1` | 传 `-v` 给 rcoder-cli |
| `SMOKE_DEBUG=1` / `--debug` | 打印解析后的 provider/model/forward env |
| `SMOKE_DRY_RUN=1` / `--dry-run` | 只打印 rcoder 命令，不调 API |
| `AGENT_ENTRY` / `--entry` | 指定入口 TS 文件 |

`--entry` 或 `AGENT_ENTRY` 可指定任意入口；`--debug --dry-run` 可在无 API key 时检查命令与 env 解析。

**通过/失败**：见 `lib/smoke-outcome.mjs` —— 以 session-trace 的 `flowStatus` + 产出/流式指标为准；`interrupted` + `streamed`（HITL 首轮）与 `done` + `streamed` 均算通过；rcoder 的 `Session cancelled` 在 trace 正常时忽略。细则见 part4b-smoke-acp.md § 通过/失败判定。

开发 Agent 工作流细则见 monorepo `packages/dev-agent-flow/skills/flow-builder/references/part4b-smoke-acp.md`。

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
| `lib/smoke-env.mjs` | smoke 模型 env 解析（与 runtime 对齐） |
| `lib/smoke-outcome.mjs` | smoke 输出解析（session-trace 优先于 rcoder 噪音） |
| `lib/example-registry.mjs` | 范例别名注册表 |
