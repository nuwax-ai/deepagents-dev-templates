# 在 Zed 里调试 flow（ACP）

Zed 通过 ACP（stdio）连接外部 agent。把下面的 `agent_servers` 加进 Zed 的 `settings.json`
（`Cmd+,`），就能在 agent 面板里 chat 调试本模板的每个入口。

> **`<REPO>`** = 本模板解压后的**仓库根目录**绝对路径（即含 `package.json` 的目录），
> 例如 `/Users/you/workspace/my-flow-agent`。
>
> 首次使用前在本目录执行：`pnpm install`（`tsx` 会装进 `node_modules/.bin/`）。

## 占位符

配置里的 `env` 先换成你自己的值（与 [.env.example](../.env.example) 一致）：

| 占位符 | 含义 |
|--------|------|
| `<YOUR_OPENAI_API_KEY>` | OpenAI 兼容 API Key |
| `<YOUR_OPENAI_BASE_URL>` | 兼容端点根 URL（须含 `/v1`，且**不能留空**） |
| `<YOUR_OPENAI_MODEL>` | 该端点上的模型名 |
| `<REPO>` | 本模板根目录绝对路径 |

使用 OpenAI 兼容协议时，将 [config/flow-agent.config.json](../config/flow-agent.config.json) 的 `model.provider` 设为 `"openai"`。

**共用 `env` 片段**（下面每个入口的 `env` 相同，只改 `args` 即可）：

```jsonc
"env": {
  "OPENAI_API_KEY": "<YOUR_OPENAI_API_KEY>",
  "OPENAI_BASE_URL": "<YOUR_OPENAI_BASE_URL>",
  "OPENAI_MODEL": "<YOUR_OPENAI_MODEL>",
  "MAX_TOKENS": "16384",
  "LOG_LEVEL": "debug",
  "LOG_DIR": "<REPO>/.logs"
}
```

## 推荐配置（OpenAI 兼容）

```jsonc
{
  "agent_servers": {
    "flow · 默认 ReAct": {
      "type": "custom",
      "command": "tsx",
      "args": ["<REPO>/src/index.ts"],
      "env": {
        "OPENAI_API_KEY": "<YOUR_OPENAI_API_KEY>",
        "OPENAI_BASE_URL": "<YOUR_OPENAI_BASE_URL>",
        "OPENAI_MODEL": "<YOUR_OPENAI_MODEL>",
        "MAX_TOKENS": "16384",
        "LOG_LEVEL": "debug",
        "LOG_DIR": "<REPO>/.logs"
      }
    },
    "flow · RAG": {
      "type": "custom",
      "command": "tsx",
      "args": ["<REPO>/examples/rag/index.ts"],
      "env": {
        "OPENAI_API_KEY": "<YOUR_OPENAI_API_KEY>",
        "OPENAI_BASE_URL": "<YOUR_OPENAI_BASE_URL>",
        "OPENAI_MODEL": "<YOUR_OPENAI_MODEL>",
        "MAX_TOKENS": "16384",
        "LOG_LEVEL": "debug",
        "LOG_DIR": "<REPO>/.logs"
      }
    },
    "flow · travel-planner": {
      "type": "custom",
      "command": "tsx",
      "args": ["<REPO>/examples/travel-planner/index.ts"],
      "env": {
        "OPENAI_API_KEY": "<YOUR_OPENAI_API_KEY>",
        "OPENAI_BASE_URL": "<YOUR_OPENAI_BASE_URL>",
        "OPENAI_MODEL": "<YOUR_OPENAI_MODEL>",
        "MAX_TOKENS": "16384",
        "LOG_LEVEL": "debug",
        "LOG_DIR": "<REPO>/.logs"
      }
    },
    "flow · project-manager": {
      "type": "custom",
      "command": "tsx",
      "args": ["<REPO>/examples/project-manager/index.ts"],
      "env": {
        "OPENAI_API_KEY": "<YOUR_OPENAI_API_KEY>",
        "OPENAI_BASE_URL": "<YOUR_OPENAI_BASE_URL>",
        "OPENAI_MODEL": "<YOUR_OPENAI_MODEL>",
        "MAX_TOKENS": "16384",
        "LOG_LEVEL": "debug",
        "LOG_DIR": "<REPO>/.logs"
      }
    },
    "flow · human-in-loop": {
      "type": "custom",
      "command": "tsx",
      "args": ["<REPO>/examples/human-in-loop/index.ts"],
      "env": {
        "OPENAI_API_KEY": "<YOUR_OPENAI_API_KEY>",
        "OPENAI_BASE_URL": "<YOUR_OPENAI_BASE_URL>",
        "OPENAI_MODEL": "<YOUR_OPENAI_MODEL>",
        "MAX_TOKENS": "16384",
        "LOG_LEVEL": "debug",
        "LOG_DIR": "<REPO>/.logs"
      }
    },
    "flow · Deepresearch": {
      "type": "custom",
      "command": "tsx",
      "args": ["<REPO>/examples/deep-research/index.ts"],
      "env": {
        "OPENAI_API_KEY": "<YOUR_OPENAI_API_KEY>",
        "OPENAI_BASE_URL": "<YOUR_OPENAI_BASE_URL>",
        "OPENAI_MODEL": "<YOUR_OPENAI_MODEL>",
        "MAX_TOKENS": "16384",
        "LOG_LEVEL": "debug",
        "LOG_DIR": "<REPO>/.logs"
      }
    }
  }
}
```

### `tsx` 找不到时

把 `"command": "tsx"` 改成包内绝对路径（更稳，不依赖 PATH）：

```jsonc
"command": "<REPO>/node_modules/.bin/tsx"
```

Windows 用 `tsx.cmd`：`"<REPO>/node_modules/.bin/tsx.cmd"`。

## 关键点

1. **凭证必须经 `env` 注入**：Zed 启动 agent 时 cwd 不在模板目录，`loadDotenv()` 读不到 `.env`。
2. **入口不带子命令 = ACP 模式**：`args` 只给 `index.ts` 路径（不加 `rag` / `plan` / `research` 等 CLI 子命令）。
3. **`type": "custom"`**：部分 Zed 版本 schema 要求显式声明。
4. **`OPENAI_*` 三项都填且非空**：任一为空会触发配置校验失败（尤其 `OPENAI_BASE_URL` 不能是 `""`）。
5. **路径一律相对 `<REPO>`**：即本模板根目录。

## 各入口的凭证需求

| agent | 是否真调 LLM | 说明 |
|-------|-------------|------|
| 默认 ReAct | 有 key 则调；无则启发式 fallback | 可不填 key 做连通性测试 |
| RAG | **必须** | rewrite / retrieve / generate + MCP |
| travel-planner | 是（调研节点） | 建议有效 key；含 DuckDuckGo MCP |
| project-manager | 是（规划/评估） | 建议有效 key |
| human-in-loop | 是（生成草稿） | 建议有效 key |
| Deepresearch | **必须** | 多阶段长任务，耗时长、token 多 |

## Anthropic 协议（可选）

若用 Anthropic 协议，保持 `model.provider` 为 `anthropic`，`env` 改用：

| 占位符 | 含义 |
|--------|------|
| `<YOUR_ANTHROPIC_API_KEY>` | Anthropic API Key（或 `ANTHROPIC_AUTH_TOKEN`） |
| `<YOUR_ANTHROPIC_BASE_URL>` | 自托管网关 URL（可选；若填则**非空**） |
| `<YOUR_ANTHROPIC_MODEL>` | 模型名 |

```jsonc
"env": {
  "ANTHROPIC_API_KEY": "<YOUR_ANTHROPIC_API_KEY>",
  "ANTHROPIC_BASE_URL": "<YOUR_ANTHROPIC_BASE_URL>",
  "ANTHROPIC_MODEL": "<YOUR_ANTHROPIC_MODEL>",
  "LOG_LEVEL": "debug",
  "LOG_DIR": "<REPO>/.logs"
}
```

## HITL 示例怎么玩（ACP 多轮）

travel-planner / project-manager / human-in-loop / deep-research 是 `StatefulFlow`，在 Zed 里通常 **两条以上消息** 走完一轮：

| 示例 | 第一条（任务） | agent 回 | 下一条（resume） |
|------|----------------|----------|------------------|
| travel-planner | `东京 3 天 美食优先` | 行程草案 + 确认 | `ok` / `预算紧一点` |
| project-manager | `做一个落地页` | 计划 + 甘特 + 审批 | `ok` / `加个评审` |
| human-in-loop | `写一段产品介绍` | 草稿 + 修改意见 | `ok` / `改短一点` |
| Deepresearch | `调研某某主题` | 选题/大纲确认门 | 按提示确认或修改 |

机制：`interrupt` 后本轮 `end_turn`；**下一条用户消息** 作为 `resume`（同 session = 同 thread，checkpoint 续状态）。
`rcoder-cli` 冒烟是 one-shot，多轮 HITL 请在 Zed 手测。

## 看日志

`LOG_DIR`（如 `<REPO>/.logs`）下会有各 flow 的结构化日志（`runtime:flow-graph`、`runtime:travel` 等）。
`LOG_LEVEL=debug` 可排查 ACP 握手、`onPrompt`、`interrupt`。目录已在 `.gitignore` 内。
