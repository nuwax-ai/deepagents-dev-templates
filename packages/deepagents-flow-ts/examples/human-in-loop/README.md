# 示例：人审定稿（human-in-the-loop）

生成内容 → **暂停让人审阅** → 按意见定稿。审批、校对、可控生成都属此类需求。
这是模板 **`StatefulFlow`** seam 的范例——和 one-shot 示例（RAG / router）不同，它能在图中途
`interrupt` 暂停、把问题抛给用户、拿到回复再 `resume`。

对应 LangGraph 官方：**Human-in-the-loop / wait for user input**（`interrupt` + `Command({ resume })` + checkpointer）。

## 图

```
START → compose → review(interrupt 暂停) → finalize → END
                      ▲ 抛草稿给用户、等回复        └ 按回复定稿
```

| 节点 | 职责 |
|---|---|
| `compose` | **真调 LLM**写初稿 |
| `review` | `interrupt` 暂停，把草稿抛给用户审阅 |
| `finalize` | 按用户回复定稿（ok→通过；否则并入意见） |

> ⚠️ 节点名不能与 state channel 同名：channel 有 `draft`，所以"写草稿"的节点叫 `compose`。

## 它如何用模板的 HITL seam

图 `compile({ checkpointer: new MemorySaver() })`，`createReviewFlow()` 返回一个 **`StatefulFlow`**：

```ts
const flow = createReviewFlow(appConfig); // 真调 LLM，需模型凭证
const r1 = await flow.run({ query: "写产品介绍" }, threadId); // → { status: "interrupted", question }
const r2 = await flow.run({ resume: "改短一点" }, threadId);   // → { status: "done", answer }
```

`threadId` 让 checkpointer 续接状态（两次 run 之间草稿不丢）；resume 时 `review` 节点从头重跑、
`interrupt` 直接返回用户回复。surface（acp/cli）只认 `StatefulFlow` 接口，plumbing 完全复用。

## 运行

```bash
pnpm --filter deepagents-app-ts build   # 先构建 runtime

# CLI：跑到草稿→暂停等你输入审阅意见（同一终端继续输入）
pnpm --filter deepagents-flow-ts exec tsx examples/human-in-loop/index.ts review "写一段产品介绍"
# 交互
pnpm --filter deepagents-flow-ts exec tsx examples/human-in-loop/index.ts review -i
# ACP 服务
pnpm --filter deepagents-flow-ts exec tsx examples/human-in-loop/index.ts
```

**ACP 下的多轮**：agent 发出草稿+问题后 `end_turn`，你的**下一条消息**即被当作 resume（审阅意见）。
模板用 sessionId 作 threadId、记录"该 session 在等回复"，所以无需额外协议支持就能多轮闭环。

> **自动化覆盖**：interrupt→resume 闭环由 CLI（`runStatefulCli`）实跑 + 本目录单测保证；
> `rcoder-cli chat` 是 one-shot（单 prompt），不能脚本化多轮，所以 `smoke:review` 只验 ACP **第一轮**
> （query→interrupt→发问题）。**多轮 resume 请在 Zed 里手测**（第一条发任务、第二条发审阅意见）——
> ACP 与 CLI 共用同一套 `StatefulFlow` 状态机（`awaitingResume`），逻辑等价。

> **真实接入（无 demo fallback）**：`compose`/`finalize` 真调大模型，需在 `.env` 配模型凭证
> （`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `OPENAI_API_KEY`，没配会直接报错而非降级）。
> `review` 的 interrupt/resume 是纯模板逻辑，与模型无关。

## 测试

[tests/review.test.ts](tests/review.test.ts)：**纯函数** `isApproval`（通过判定，无凭证恒跑）；
**真实接入**用例（`skipIf` 无凭证）跑 LLM compose/finalize + interrupt→resume 闭环 + 不同 threadId 状态隔离。
