# 在 Zed 里调试 flow（ACP）

Zed 通过 ACP（stdio）连接外部 agent。把下面的 `agent_servers` 加进 Zed 的 `settings.json`
（`Cmd+,`），就能在 Zed 的 agent 面板里 chat 调试本包的每个入口。

> 把 `<REPO>` 替换为你的仓库根绝对路径，例如 `/Users/you/workspace/deepagents-dev-templates-rag`。
> 先跑 `pnpm --filter deepagents-app-ts build` 构建 runtime 依赖。

```jsonc
{
  "agent_servers": {
    "flow · 默认 ReAct": {
      "command": "<REPO>/packages/deepagents-flow-ts/node_modules/.bin/tsx",
      "args": ["<REPO>/packages/deepagents-flow-ts/src/index.ts"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-你的key",
        "LOG_DIR": "<REPO>/logs",
        "LOG_LEVEL": "debug"
      }
    },
    "flow · RAG": {
      "command": "<REPO>/packages/deepagents-flow-ts/node_modules/.bin/tsx",
      "args": ["<REPO>/packages/deepagents-flow-ts/examples/rag/index.ts"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-你的key", "LOG_DIR": "<REPO>/logs", "LOG_LEVEL": "debug" }
    },
    "flow · travel-planner": {
      "command": "<REPO>/packages/deepagents-flow-ts/node_modules/.bin/tsx",
      "args": ["<REPO>/packages/deepagents-flow-ts/examples/travel-planner/index.ts"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-你的key", "LOG_DIR": "<REPO>/logs", "LOG_LEVEL": "debug" }
    },
    "flow · project-manager": {
      "command": "<REPO>/packages/deepagents-flow-ts/node_modules/.bin/tsx",
      "args": ["<REPO>/packages/deepagents-flow-ts/examples/project-manager/index.ts"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-你的key", "LOG_DIR": "<REPO>/logs", "LOG_LEVEL": "debug" }
    },
    "flow · human-in-loop": {
      "command": "<REPO>/packages/deepagents-flow-ts/node_modules/.bin/tsx",
      "args": ["<REPO>/packages/deepagents-flow-ts/examples/human-in-loop/index.ts"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-你的key", "LOG_DIR": "<REPO>/logs", "LOG_LEVEL": "debug" }
    }
  }
}
```

## 关键点

1. **凭证必须经 `env` 注入**，不能靠 `.env`：Zed 启动 agent 的 cwd 不在包目录，`loadDotenv()` 读不到包里的 `.env`。
2. **入口不带子命令 = ACP 模式**：`args` 只给入口文件路径（不加 `rag`/`plan`/`review`，那些只在 CLI 用）。
3. **`tsx` 用包级绝对路径** `node_modules/.bin/tsx`，避免依赖 Zed 的 PATH。
4. 较新 Zed 不需要 `"type"` 字段；若你的版本报 schema 错，给每个 entry 补 `"type": "custom"`。

## 各入口的凭证需求

| agent | 节点是否真调 LLM | 凭证 |
|---|---|---|
| 默认 ReAct | think/reflect/respond 有凭证则调、无则启发式 fallback | 填真 key 体验完整；不填走 fallback |
| **RAG** | 是（rewrite / retrieve / generate） | **必须有效 key**（+ context7 MCP） |
| travel-planner | 否（demo 数据） | 内容固定；key 仅供 ACP 启动构造 throwaway agent |
| project-manager | 否（纯逻辑） | 同上 |
| human-in-loop | 否（模板草稿） | 同上 |

## Provider 切换

默认 [config/flow-agent.config.json](../config/flow-agent.config.json) 是 `anthropic / claude-sonnet-4-6`。
- **自托管 Anthropic 网关**：`env` 加 `"ANTHROPIC_BASE_URL": "https://你的网关"`（别填空串，空串会触发 Zod `.url()` 报错）。
- **OpenAI 兼容端点（如 mimo）**：把 config 的 `model.provider` 改 `"openai"`，`env` 用 `OPENAI_API_KEY` + `OPENAI_BASE_URL` + `OPENAI_MODEL`（三个都要、都别留空）。

## HITL 示例怎么玩（也是 ACP 多轮的手测方式）

travel-planner / project-manager / human-in-loop 是 `StatefulFlow`，在 Zed 里**两条消息**走完一轮：

| 示例 | 第一条（任务） | agent 回 | 第二条（resume） |
|---|---|---|---|
| travel-planner | `东京 3 天 美食优先` | 并行规划出行程草案 +「OK 吗？」 | `ok` / `预算紧一点` |
| project-manager | `做一个落地页` | 任务计划 + 甘特 +「批准？」 | `ok` / `加个上线评审` |
| human-in-loop | `写一段产品介绍` | 草稿 +「要怎么改？」 | `ok` / `改短一点` |

机制：agent 在 `interrupt` 处发问题后结束本轮（`end_turn`），你的**下一条消息**被模板当作 `resume`
（同一 session = 同一 thread，`MemorySaver` 续接状态）。这也是 ACP 端多轮 HITL 的验证方式——
`rcoder-cli chat` 是 one-shot，无法脚本化多轮，故多轮在这里手测。

## 看日志

`LOG_DIR` 指向的目录会写各节点的结构化日志（`runtime:flow-graph` / `runtime:travel` / `runtime:pm` …），
配 `LOG_LEVEL=debug` 排查 ACP 握手 / `onPrompt` / `interrupt` 流程。`logs/` 已在 `.gitignore` 内。
