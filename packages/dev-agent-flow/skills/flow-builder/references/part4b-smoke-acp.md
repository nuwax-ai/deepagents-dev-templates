# Part 4b：`pnpm smoke`（rcoder-cli 端到端）

> 所属：`flow-builder` L2-D 子文档。完成闸门见 [part4a-verify-debug.md](part4a-verify-debug.md)。
> **模型 env 解析**由目标项目 `scripts/lib/smoke-env.mjs` 实现（与 runtime `config-loader` 对齐）。

## 它验证什么 / 不验证什么

| ✅ 验证 | ❌ 不验证 |
|---------|-----------|
| ACP 握手 → `onPrompt` → 当前 `activeFlow` 图跑通 | `parse` 与 `write` 语义（**R-G001**，需静态规则或边界 prompt） |
| 模型凭证 + provider/model 解析正确 | HITL 多轮 resume（one-shot only） |
| 子进程未吃到 `{MODEL_PROVIDER_*}` 占位符 | 与平台 `<PLATFORM_CONFIG>` 完全一致（本地用 `.env`） |

---

## 前置：用当前环境生成可用模型（必做）

**不要手猜 `OPENAI_MODEL=...`**。按下面顺序，smoke 脚本会自动解析并 `-e` 传给 rcoder：

### 1. 复制并填写 `.env`

```bash
cp .env.example .env
# 填写 OPENAI_API_KEY + OPENAI_BASE_URL + OPENAI_MODEL（或 Anthropic 族）
```

与 `config/flow-agent.config.json` 的 `model.provider` 一致（默认 `openai` + `deepseek-chat`）。

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
| `OPENAI_API_KEY` / `ANTHROPIC_*` | 凭证（必填其一） |
| `OPENAI_MODEL` / `ANTHROPIC_MODEL` | **优先**于 config 的 `model.name` |
| `OPENAI_BASE_URL` | OpenAI 兼容端点 |
| `API_PROTOCOL` / `LLM_PROVIDER` | 显式 `openai` \| `anthropic` |
| `SMOKE_PROMPT` | 主路径用户输入（默认 React 题） |
| `SMOKE_PROMPT_EDGE` | **第二条** prompt（如 `你是？`，验入口节点 **R-G002**） |
| `SMOKE_EXPECT_ACTIVE_FLOW` | 与 `activeFlow` 不一致 → exit 1 |
| `SMOKE_WARN_ACTIVE_FLOW=0` | 关闭 `activeFlow=default` 警告 |
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
| `pnpm smoke -- --example rag` | `examples/rag/index.ts` |
| `pnpm smoke -- --example review` | human-in-loop |
| `pnpm smoke -- --example dev-agent` | dev-agent |

---

## 与完成闸门的关系

- **必须真实跑** `pnpm smoke`（禁止 `--dry-run` 冒充通过）。
- 开发 **custom / stateful** flow 时：先改 `activeFlow`，再设 `SMOKE_PROMPT`（+ 可选 `SMOKE_PROMPT_EDGE`）。
- smoke 绿 **不能**替代 **R-G001** 静态核对；边界类 bug 靠 `SMOKE_PROMPT_EDGE` 或 `docs/flow-graph-rules.md`。

---

## Anti-patterns

- ❌ 不设 `.env` 凭证就报 smoke 完成
- ❌ `activeFlow=default` 却声称 custom flow 已验过 ACP
- ❌ 手 export 一堆模型 env 覆盖 config，而不改 `.env` / config
- ❌ 只跑 `build/test/graph`，跳过 smoke
- ❌ 见 `400 Invalid model` 就改 config 模型名，不查占位符与 `.env`
- ✅ `.env` + `activeFlow` + `SMOKE_PROMPT*` + `SMOKE_DEBUG` 干跑确认 → 真跑 smoke
