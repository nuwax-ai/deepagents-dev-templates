# 阶段 E 调研：usage_update / 模式面

[← 返回路线图](./roadmap-progress.md)

**调研日期**：2026-06-27  
**结论**：**暂缓实施**（2026-06-27 决策：暂时不考虑用量 / 模式面）。Legacy 有部分能力，Flow 主路径未出站；NuwaClaw 工作流 Agent 当前不依赖。

---

## 1. 官方 ACP session/update 类型

| sessionUpdate | 用途 | claude-code-acp-ts | flow-ts Flow 路径 | flow-ts Legacy |
| --- | --- | --- | --- | --- |
| `usage_update` | 上下文 token 用量 / 成本 | ✅ 每轮 result 后 | ❌ | ❌ |
| `current_mode_update` | agent/plan/ask 模式切换 | ✅ | ❌ | ❌（`set_mode` 只写 session 状态） |
| `available_commands_update` | slash 命令列表 | ✅ | ❌ | ✅ session 创建时 |
| `config_option_update` | 模型/effort 等配置项 | ✅ | ❌ | ❌ |

---

## 2. 现有代码锚点

### 2.1 usage 数据已有，未出站 ACP

[`llm-resilience.ts`](../../../../../packages/deepagents-flow-ts/src/runtime/services/llm-resilience.ts) 在 LLM 返回后解析 `usage_metadata`，写日志：

```
log.info("LLM usage", { inputTokens, outputTokens, cachedTokens, ... })
```

[`session-trace.ts`](../../../../../packages/deepagents-flow-ts/src/runtime/session-trace.ts) 的 `traceFlowCallbacks` 只 trace，**不发** `sessionUpdate`。

参考 [claude-code-acp-ts ~L1203](https://github.com/nuwax-ai/claude-code-acp-ts)：

```typescript
sessionUpdate: "usage_update",
used: lastAssistantTotalUsage,
size: session.contextWindowSize,
cost: { amount, currency: "USD" },
```

### 2.2 模式面：Legacy 半实现

[`deepagents-acp/server.ts`](../../../../../packages/deepagents-flow-ts/src/libs/deepagents-acp/server.ts)：

| 能力 | 实现 | 出站 |
| --- | --- | --- |
| `session/new` modes 列表 | `AVAILABLE_MODES` | ✅ 在 new session response |
| `available_commands_update` | `configureSession` / session 创建 | ✅ |
| `session/set_mode` | `handleSetSessionMode` 写 `session.mode` | ❌ 无 `current_mode_update` |
| Flow `onPrompt` 短路 | 不跑 agent loop | 模式面对 Flow **无影响** |

### 2.3 Flow 路径

- 无 slash 命令处理（`onPrompt` 直接跑图）
- 无 plan/agent/ask 模式切换 UI 契约
- `write_todos` / custom writer `plan` 已覆盖任务清单展示

---

## 3. 何时值得做

| 场景 | 建议 |
| --- | --- |
| NuwaClaw / Zed 要显示 **上下文用量条、费用** | 做 `usage_update`（从 `llm-resilience` 汇总 per-turn） |
| 宿主支持 **Plan / Ask 模式** 切换 | 做 `current_mode_update` + `session/set_mode` 联动 |
| 仅工作流图 Agent | **可跳过** E；与 claude-code-acp-ts 全功能 Agent 定位不同 |

---

## 4. 实施草案（产品确认后）

### E-usage（预估 ~150 行）

1. `llm-resilience` 返回 `{ usage }` 或通过 callback 上报  
2. `buildAcpCallbacks` 或 `traceFlowCallbacks` 层累计 `used`  
3. `server.ts` 在 `prompt_end` 前 `conn.sessionUpdate({ sessionUpdate: "usage_update", used, size })`  
4. `size` 可先写死 128k/200k 或从 model config 读

### E-mode（预估 ~200 行）

1. Flow server 实现 `session/set_mode` hook（或扩展现有 DeepAgentsServer）  
2. 切换后 `current_mode_update`  
3. 图内按 mode 限制工具（ask 模式禁 write_file 等）——**需产品规则**

---

## 5. 任务状态

| ID | 任务 | 状态 |
| --- | --- | --- |
| E-usage | `usage_update` 出站 | ⏸️ 暂缓 |
| E-mode | `current_mode_update` + set_mode | ⏸️ 暂缓 |
| E-commands | Flow 路径 slash | — 跳过（无 slash） |
| E-plan-timing | write_todos → plan 时机对齐 | ⏸️ 暂缓 |

---

## 6. 与参考实现差距（可接受）

flow-ts 定位是 **LangGraph 工作流 + NuwaClaw 部署**，不是 Claude Code 全功能 IDE Agent。  
阶段 A/B/D 已对齐 **工具出站**；阶段 E 属于 **宿主 UX 增强**，**当前路线图外**，不影响 ask-question / tool 展示正确性。
