# 示例：人审定稿（human-in-the-loop）

生成内容 → **暂停让人审阅** → 按意见定稿。审批、校对、可控生成都属此类需求。
这是模板 **`StatefulFlow`** 接入层（seam）的范例——和 one-shot 示例（RAG / router）不同，它能在图中途
`interrupt` 暂停、把问题抛给用户、拿到回复再 `resume`。

对应 LangGraph 官方：**Human-in-the-loop / wait for user input**（`interrupt` + `Command({ resume })` + checkpointer）。

## 图

```
START → compose → present_review(ask-question MCP) → review(interrupt) → finalize → END
                      ▲ 平台问答卡片                    ▲ 等回复          └ 按回复定稿
```

| 节点 | 职责 |
|---|---|
| `compose` | **真调 LLM**写初稿 |
| `present_review` | 调 ask-question MCP 在**平台问答卡片**中展示「通过/修改 + 修改意见」；不可用时优雅降级 |
| `review` | `interrupt` 暂停，把草稿抛给用户审阅 |
| `finalize` | 按用户回复定稿（ok→通过；否则并入意见） |

> ⚠️ 节点名不能与 state channel 同名：channel 有 `draft`，所以"写草稿"的节点叫 `compose`。

## 它如何用模板的 HITL 接入层（seam）

图 `compile({ checkpointer })`，`createReviewFlow()` 返回一个 **`StatefulFlow`**：

```ts
const flow = createReviewFlow(appConfig); // 真调 LLM，需模型凭证
const r1 = await flow.run({ query: "写产品介绍" }, threadId); // → { status: "interrupted", question }
const r2 = await flow.run({ resume: "改短一点" }, threadId);   // → { status: "done", answer }
```

`threadId` 让 checkpointer 续接状态（两次 run 之间草稿不丢）；resume 时 `review` 节点从头重跑、
`interrupt` 直接返回用户回复。surface（acp/cli）只认 `StatefulFlow` 接口，接入逻辑完全复用。

`present_review` 与 `review` 必须拆成两个节点：ask-question MCP 返回 `pending`，不会自己维护
LangGraph checkpoint；`interrupt` 才是 durable resume 控制点。MCP 节点先完成并落 checkpoint，
下一轮 resume 只重跑 `review`，不会重复发送表单。
其中「**平台问答卡片**」即 **主平台的问答卡片**（模板统一技术服务用语），定义见 [docs/glossary.md](../../docs/glossary.md)。

`ask-question` MCP 已由包内 [`config/mcp.default.json`](../../config/mcp.default.json) 内置（fallback）；
平台 ACP `mcpServers` 同名时 session-wins 覆盖，无需本范例单独配置。

## 运行

```bash
# CLI：跑到草稿→暂停等你输入审阅意见（同一终端继续输入）
pnpm example review "写一段产品介绍"
# 交互
pnpm example review -i
# ACP 服务
pnpm example review
```

**ACP 下的多轮**：agent 发出草稿+问题后 `end_turn`，你的**下一条消息**即被当作 resume（审阅意见）。
模板用 sessionId 作 threadId、记录"该 session 在等回复"，所以无需额外协议支持就能多轮闭环。
支持**平台问答卡片**的 ACP 客户端会渲染结构化表单；其他客户端仍能使用 interrupt 的纯文本问题。

> **自动化覆盖**：interrupt→resume 闭环由 CLI（`runStatefulCli`）实跑 + 本目录单测保证；
> `rcoder-cli chat` 是 one-shot（单 prompt），不能脚本化多轮，所以 `pnpm smoke -- --example review` 只验 ACP **第一轮**
> （query→interrupt→发问题）。**多轮 resume 请在 Zed 里手测**（第一条发任务、第二条发审阅意见）——
> ACP 与 CLI 共用同一套 `StatefulFlow` 状态机（`awaitingResume`），逻辑等价。

> **真实接入（无 demo fallback）**：`compose`/`finalize` 真调大模型，需在 `.env` 配模型凭证
> （`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `OPENAI_API_KEY`，没配会直接报错而非降级）。
> `review` 的 interrupt/resume 是纯模板逻辑，与模型无关。

## 测试

[tests/review.test.ts](tests/review.test.ts)：**纯函数** `isApproval` / 表单响应归一化，以及 ask-question 工具事件；
**真实接入**用例（`skipIf` 无凭证）跑 LLM compose/finalize + interrupt→resume 闭环 + 不同 threadId 状态隔离。
