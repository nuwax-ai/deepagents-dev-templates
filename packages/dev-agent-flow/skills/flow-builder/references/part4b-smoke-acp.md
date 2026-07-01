# Part 4b：`pnpm smoke`（rcoder-cli 端到端）

> 所属：`flow-builder` L2-D 子文档。completion gate（完成闸门）见 [part4a-verify-debug.md](part4a-verify-debug.md)。
> **模型 env 解析**由目标项目 `scripts/lib/smoke-env.mjs` 实现（与 runtime `config-loader` 对齐）。
> **通过/失败判定**由 `scripts/lib/smoke-outcome.mjs` 实现（以 session-trace 为准，见下文）。

## 它验证什么 / 不验证什么

| ✅ 验证 | ❌ 不验证 |
|---------|-----------|
| ACP 握手 → `onPrompt` → 当前 `activeFlow` 图跑通 | `parse` 与 `write` 语义（**R-G001**，需静态规则或边界 prompt） |
| 模型凭证 + provider/model 解析正确 | HITL **多轮 resume**（one-shot only；首轮 interrupt 见下节） |
| 子进程未吃到 `{MODEL_PROVIDER_*}` 占位符 | 与平台在线配置完全一致（本地用 `.env`） |
| **HITL 首轮**：`flowStatus=interrupted` 且流式出题 / `questionChars>0` | — |

---

## 通过 / 失败判定（`smoke-outcome.mjs`）

smoke 捕获 rcoder 子进程的 stdout/stderr，**不能**单靠退出码或 rcoder 收尾字符串判成败：

- rcoder 常在 turn 正常结束后仍打 `Session cancelled` / `Prompt ended with error`（exit 0 或 1）
- 以 **`[runtime:session-trace]`** 里最后一次 `flow.run done` + `prompt_end` 合并字段为准

实现：`scripts/lib/smoke-outcome.mjs`（单测 `tests/smoke-outcome.test.ts`）。

### 解析字段

从日志行 `flow.run done` / `prompt_end` 合并：

`flowStatus`、`outputChars`、`answerChars`、`questionChars`、`streamed`、`streamChars`、`tokenChunks`

### 判为通过

| `flowStatus` | 条件（满足任一） |
|--------------|------------------|
| `done` | `outputChars>0` 或 `answerChars>0` |
| `done` | `streamed=true` 且（`streamChars>0` 或 `tokenChunks>0`） |
| `interrupted` | `questionChars>0`（HITL 首轮出题） |
| `interrupted` | `streamed=true` 且（`streamChars>0` 或 `tokenChunks>0`） |

trace 通过后：**忽略** rcoder 的 `Session cancelled` / `Prompt ended with error`，并将退出码视为 0。

典型场景：

- **router-gate**（`llm-stream`）：`done` + `streamed=true` → 绿
- **interview-agent**（HITL `wait`）：`interrupted` + `streamed=true` + `questionChars>0` → 绿（图在首轮暂停属预期）

### 判为失败

- 无任何 session-trace，且输出含 `Session cancelled` 等（空答 / 真异常）
- `interrupted` 但无 `questionChars`、无流式指标（`streamed=false` 或 `streamChars/tokenChunks=0`）
- 其他 `flowStatus` 或无产出

调试：`SMOKE_DEBUG=1 pnpm smoke` 在 trace 通过时打印 `flow trace OK: {...}`。

---

## 模型 env 解析优先级（`smoke-env.mjs`）

smoke 加载 `.env` 时用 `override:true` —— **项目 `.env` 覆盖** NuWaClaw / shell 注入的占位符或旧值；`.env` 未设的键再回落到注入 env。

| 层级 | 规则 |
|------|------|
| 凭证 | `OPENAI_API_KEY` / `ANTHROPIC_*` / `OPENCODE_OPENAI_API_KEY`（任一即可） |
| Provider | `API_PROTOCOL` / `LLM_PROVIDER` > **凭证推断** > `config.model.provider` |
| Model | `OPENAI_MODEL` > `ANTHROPIC_MODEL` > `DEFAULT_MODEL` > `config.model.name`（与 provider 无关，对齐 runtime `ENV_MAP`） |
| Base URL | `OPENAI_BASE_URL` > `ANTHROPIC_BASE_URL` > `config.model.baseUrl` |
| OPENCODE 兜底 | standard 键缺失时，用 `OPENCODE_OPENAI_API_KEY` / `OPENCODE_OPENAI_API_BASE` / `OPENCODE_MODEL`（NuWaClaw opencode 下发）；forward 仍发 standard 键给 rcoder |

**NuWaClaw 内跑 smoke**：若 shell 已有 `OPENCODE_*` 或 `API_PROTOCOL` + 单家族 key，可不建 `.env`；本地开发仍推荐 `cp .env.example .env`。

---

## 前置：用当前环境生成可用模型（必做）

**不要手猜 `OPENAI_MODEL=...`**。按上面优先级，smoke 脚本自动解析并 `-e` 传给 rcoder：

### 1. 复制并填写 `.env`（本地开发推荐）

```bash
cp .env.example .env
# 填写 OPENAI_API_KEY + OPENAI_BASE_URL + OPENAI_MODEL（或 Anthropic 族）
```

默认与 `config/flow-agent.config.json` 的 `openai` + `deepseek-chat` 对齐；provider 以解析结果为准（见上表），不必与文件硬绑。

### 2. 确认 `activeFlow` 指向正在开发的 flow

```json
// config/flow-agent.config.json
{ "activeFlow": "interview-agent", ... }
```

smoke 默认入口 `src/index.ts` 读此字段。若仍为 `default`，脚本会 **WARN**（测的是 ReAct 默认图，不是你的 custom flow）。

强制校验：

```bash
SMOKE_EXPECT_ACTIVE_FLOW=interview-agent pnpm smoke
```

### 3. 运行（五连中的最后一项）

```bash
pnpm build && pnpm typecheck && pnpm test && pnpm graph && pnpm smoke
```

---

## 环境变量速查

| 变量 | 作用 |
|------|------|
| `OPENAI_API_KEY` / `ANTHROPIC_*` / `OPENCODE_OPENAI_API_KEY` | 凭证（必填其一） |
| `OPENAI_MODEL` / `ANTHROPIC_MODEL` / `DEFAULT_MODEL` | 模型名（见上表优先级） |
| `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` | 端点（`OPENCODE_OPENAI_API_BASE` 可兜底） |
| `API_PROTOCOL` / `LLM_PROVIDER` | 显式 `openai` \| `anthropic`（最高优先） |
| `SMOKE_PROMPT` | 主路径用户输入（默认 React 题） |
| `SMOKE_PROMPT_EDGE` | **第二条** prompt（如 `你是？`，验入口节点 **R-G002**） |
| `SMOKE_EXPECT_ACTIVE_FLOW` | 与 `activeFlow` 不一致 → exit 1 |
| `SMOKE_WARN_ACTIVE_FLOW=0` | 关闭 `activeFlow=default` 警告 |
| `SMOKE_TIMEOUT` | rcoder 超时秒数（默认 `150`） |
| `SMOKE_VERBOSE=1` | 传 `-v` 给 rcoder-cli |
| `SMOKE_DEBUG=1` | 打印解析后的 provider/model/forward env |
| `SMOKE_DRY_RUN=1` | 只打印 rcoder 命令，不调 API |
| `AGENT_ENTRY` / `--entry` | 非默认入口（如 `examples/rag/index.ts`） |

### 按 flow 定制 prompt 示例

```bash
# interview-agent：happy path + 边界
SMOKE_PROMPT='岗位：高级前端… 简历：5年React…' \
SMOKE_PROMPT_EDGE='你是？' \
SMOKE_EXPECT_ACTIVE_FLOW=interview-agent \
pnpm smoke
```

### 占位符问题（曾导致 400 Invalid model）

rcoder-cli 子进程可能继承未替换的 `ANTHROPIC_MODEL={MODEL_PROVIDER_MODEL_NAME}`。  
`smoke-acp.mjs` 会 **跳过占位符**，并用 `.env` + `flow-agent.config.json` 解析后显式 `-e OPENAI_MODEL=...`。

排查：`SMOKE_DEBUG=1 pnpm smoke -- --debug --dry-run`

---

## 命令别名

| 命令 | 入口 |
|------|------|
| `pnpm smoke` | `src/index.ts`（读 `activeFlow`） |
| `pnpm smoke -- --example rag` | RAG |
| `pnpm smoke -- --example travel` | 旅行规划（map-reduce + HITL） |
| `pnpm smoke -- --example pm` | 项目管理 |
| `pnpm smoke -- --example review` | human-in-loop |
| `pnpm smoke -- --example dev-agent` | dev-agent |
| `pnpm smoke -- --example research` | 深度研究 |

完整列表：`pnpm example --list`。本地手测范例用 `pnpm example <name>`（CLI/ACP 模式，见 `scripts/run-example.mjs`）。

---

## 与 completion gate（完成闸门）的关系

- **必须真实跑** `pnpm smoke`（禁止 `--dry-run` 冒充通过）。
- 开发 **custom / stateful** flow 时：先改 `activeFlow`，再设 `SMOKE_PROMPT`（+ 可选 `SMOKE_PROMPT_EDGE`）。
- smoke 绿 **不能**替代 **R-G001** 静态核对；边界类 bug 靠 `SMOKE_PROMPT_EDGE` 或 `docs/flow-graph-rules.md`。

---

## Anti-patterns

- ❌ 见 `Session cancelled` / `Prompt ended with error` 就判 smoke 失败（应先查 session-trace；HITL `interrupted` + 流式出题可通过）
- ❌ 无任何可用模型凭证（`.env` / shell / `OPENCODE_*`）就报 smoke 完成
- ❌ `activeFlow=default` 却声称 custom flow 已验过 ACP
- ❌ 手 export 一堆模型 env 覆盖 config，而不改 `.env` / config
- ❌ 只跑 `build/test/graph`，跳过 smoke
- ❌ 见 `400 Invalid model` 就改 config 模型名，不查占位符与 `.env`
- ✅ `.env` + `activeFlow` + `SMOKE_PROMPT*` + `SMOKE_DEBUG` 干跑确认 → 真跑 smoke
