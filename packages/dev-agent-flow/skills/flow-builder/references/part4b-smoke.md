# Part 4b：flow-debugger 真实调试

> 所属：`flow-builder` L2-D 子文档。completion gate（完成闸门）见 [part4a-verify-debug.md](part4a-verify-debug.md)。
> 文件名保留 `part4b-smoke.md` 仅为兼容旧链接；本地 `pnpm smoke` / rcoder-cli 已移除。

## 它验证什么 / 不验证什么

| 验证 | 不验证 |
|------|--------|
| 平台真实 agent 会话端到端跑通，输出出现在用户 agent-dev 预览会话 | `parse` 与 `write` 语义的静态正确性（仍需 R-G001/R-G009） |
| 当前 `flow.active` 所选 flow 的真实执行行为 | 与本地 `.env`/rcoder 模拟一致性 |
| 平台能力真实调用：`--expect-tool` 命中且 success | 工具返回内容的业务正确性（仍需人工抽查） |
| 权限审批、ask-question、HITL 续接路径 | 后端 4sandbox 调试端点未 ready 时的最终生产质量 |
| `.logs/` runtime 错误、工具 trace、permission/模型问题 | 只靠 CLI 退出码替代日志分析 |

## 常用命令

加载 `flow-debugger` skill 后，在其 `scripts/` 目录执行：

```bash
./scripts/debug.sh --message "你是谁？"
./scripts/debug.sh --message-file prompts/test.md
./scripts/debug.sh --message "搜索今天的AI新闻" --expect-tool search
./scripts/debug.sh --message "测试" --auto-approve
OLD=$(./scripts/session.sh refresh -q)   # 可选：记录当前 devConversationId
# 请用户在预览面板点击「刷子」
./scripts/session.sh wait --previous "$OLD"
./scripts/session.sh refresh
./scripts/session.sh current
./scripts/session.sh cancel
./scripts/analyze-logs.sh
```

关键参数：

| 参数 | 说明 |
|------|------|
| `--message` / `--message-file` | 调试 prompt；中文或长 prompt 优先文件 |
| `--expect-tool` | 断言 `componentExecuteResults` 中出现**runtime/SSE 工具名子串**且 success（见 Part 3 § 三层工具名；禁止中文登记名） |
| `--auto-approve` | 自动批准权限审批 |
| `--ask-marker <requestId>` | 回答 ask-question，用同一 conversation 续接 |
| `--conversation <id>` | 指定会话；默认读平台注入的 `CONVERSATION_ID` |
| `--show-trace` | 输出完整工具 trace |

## completion gate 用法

```bash
pnpm typecheck && pnpm test && pnpm graph
./scripts/debug.sh --message "<主路径 prompt>"
```

有平台能力时必须追加工具断言：

```bash
./scripts/debug.sh \
  --message "搜索并总结今天的 AI 行业新闻，标注来源" \
  --expect-tool search
```

HITL / approval flow：

```bash
./scripts/debug.sh --message "生成一段发布文案" --auto-approve
# 若遇 ask-question：
./scripts/debug.sh --message "同意，按这个方向定稿" --ask-marker <requestId>
```

## 通过 / 失败判定

通过（**须 SSE + 日志双证**）：

- `debug.sh` exit 0（推荐 `--with-logs` 一步完成）。
- `analyze-logs.sh` exit 0，stderr 含 `[结论] 日志正常`（或 `--with-logs` 时 `[结论] SSE PASS + 日志佐证通过`）。
- 有用户可见输出，或预期的 HITL / ask-question 事件已产生并被正确续接。
- 若设置 `--expect-tool`，工具 trace 命中且 success。
- 日志侧：`[flow 状态]` 无异常、`[错误]` 无未解释项、`[工具调用]` 无 failed。

失败：

- `debug.sh` exit 4：SSE 真实执行不通过，**或 SSE 绿但日志佐证失败**（`--with-logs` 时 analyze 发现错误 / 找不到日志）。
- `debug.sh` exit 5：遇权限审批或 ask-question，必须响应后续接，不可直接报完成。
- `debug.sh` exit 3：后端 4sandbox 调试端点未就绪 / SSE 失败 / 超时。向用户说明端到端调试受后端 ready 阻塞，但静态三连仍需完成。
- 工具登记了但 `--expect-tool` 未命中。
- LLM 兜底回答有文本，但没有真实调用应调用的平台能力。

## 日志佐证（收工必经）

```bash
# 推荐：一步双证
./scripts/debug.sh --message "…" --expect-tool Plugin_783 --with-logs --auto-approve

# 或分步
./scripts/debug.sh --message "…" --expect-tool search
./scripts/analyze-logs.sh --since 10 --session <devConversationId>
```

报完成须贴 stderr 中的 **`[结论]`**、**`[flow 状态]`**、**`[工具调用]`** 摘要；缺一不可。

runtime 仍可用：

- `SMOKE_TOOL_TRACE=1`：session-trace 输出工具调用摘要，供日志分析使用。
- `AGENT_LIGHT=1`：跳过 MCP 加载，轻量验证；这不是 smoke 专属开关。

## Anti-patterns

- ❌ 用本地模拟、`pnpm flow` 或旧 rcoder smoke 冒充真实调试。
- ❌ 已登记平台能力但不加 `--expect-tool`。
- ❌ 遇 exit 5 不处理 HITL，就说验证失败或完成。
- ❌ 后端端点未 ready 时改业务代码绕过调试脚本。
- ✅ 静态三连 + flow-debugger（`--with-logs` 或 analyze-logs 佐证）+ 必要工具断言一起作为完成证据。
