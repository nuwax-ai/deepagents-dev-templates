# 在 Zed 里调试 flow（ACP）

Zed 通过 ACP（stdio）连接外部 agent。把下面的 `agent_servers` 加进 Zed 的 `settings.json`
（`Cmd+,`），就能在 agent 面板里 chat 调试当前 `flow.active`。

> **`<REPO>`** = 本模板解压后的**仓库根目录**绝对路径（即含 `package.json` 的目录），
> 例如 `/Users/you/workspace/my-flow-agent`。
>
> 首次使用前在本目录执行：`pnpm install`（`tsx` 会装进 `node_modules/.bin/`）。

## 占位符

配置里的 `env` 先换成你自己的值（与 [.env.example](../../../packages/deepagents-flow-ts/.env.example) 一致）：

| 占位符 | 含义 |
|--------|------|
| `<YOUR_OPENAI_API_KEY>` | OpenAI 兼容 API Key |
| `<YOUR_OPENAI_BASE_URL>` | 兼容端点根 URL（须含 `/v1`，且**不能留空**） |
| `<YOUR_OPENAI_MODEL>` | 该端点上的模型名 |
| `<REPO>` | 本模板根目录绝对路径 |

默认 `model.provider` 即 `"openai"`（见 [config/flow-agent.config.json](../../../packages/deepagents-flow-ts/config/flow-agent.config.json)）；改用 Anthropic 协议时设为 `"anthropic"`（见文末）。

**共用 `env` 片段**：

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
    "flow · flow.active": {
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
    }
  }
}
```

切换 flow 时只需修改 [config/flow-agent.config.json](../../../packages/deepagents-flow-ts/config/flow-agent.config.json) 的
`flow.active` 并重启 Zed agent；所有注册 flow 共用 `src/index.ts` 入口。

### `tsx` 找不到时

把 `"command": "tsx"` 改成包内绝对路径（更稳，不依赖 PATH）：

```jsonc
"command": "<REPO>/node_modules/.bin/tsx"
```

Windows 用 `tsx.cmd`：`"<REPO>/node_modules/.bin/tsx.cmd"`。

## 关键点

1. **凭证必须经 `env` 注入**：Zed 启动 agent 时 cwd 不在模板目录，`loadDotenv()` 读不到 `.env`。
2. **入口不带子命令 = ACP 模式**：`args` 只给 `src/index.ts` 路径；具体图由 `flow.active` 选择。
3. **`type": "custom"`**：部分 Zed 版本 schema 要求显式声明。
4. **`OPENAI_*` 三项都填且非空**：任一为空会触发配置校验失败（尤其 `OPENAI_BASE_URL` 不能是 `""`）。
5. **路径一律相对 `<REPO>`**：即本模板根目录。

## 凭证需求

默认 ReAct 无 key 时可走启发式 fallback 做连通性测试；需要真实 LLM、MCP 或平台能力的
flow 必须注入有效凭证。固定流程型 topology 经 scaffold 生成并注册后，同样通过 `flow.active` 调试。

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

## HITL flow 怎么玩（ACP 多轮）

用 scaffold 生成并注册 `human-in-loop`、`project-manager`、`travel-planner` 或
`deep-research` topology 后，在 Zed 里通常需要两条以上消息走完一轮：

机制：`interrupt` 后本轮 `end_turn`；**下一条用户消息** 作为 `resume`（同 session = 同 thread，checkpoint 续状态）。
本地 CLI（`pnpm flow`）是 one-shot（单 prompt）；多轮 HITL 请在 Zed 手测。

### conversational 对话怎么玩（多轮记忆）

`default` / `search-aggregator` 是 **conversational** `StatefulFlow`（`conversational: true`）——与上面 HITL 不同：**每条消息都是独立 `query`**（不暴露 `hasStarted`、不走 `resume`），靠稳定 threadId（= ACP sessionId）+ checkpointer 累积历史 → 多轮记忆。在 Zed 里像普通聊天一样连续问，agent 记得上下文；图层 `graph.stream` 真流式输出。`search-aggregator` 是平台能力对话样板（default 底座 + systemPrompt）；需要检索时先在平台登记搜索能力，运行期进入工具集后自动 bind。

## 看日志

`LOG_DIR`（如 `<REPO>/.logs`）下会有各 flow 的结构化日志（`runtime:flow-graph`、`runtime:travel` 等）。
`LOG_LEVEL=debug` 可排查 ACP 握手、`onPrompt`、`interrupt`。目录已在 `.gitignore` 内。

---

## 部署 / 安装后运行（生产模式）

以上都是**调试开发**（Zed 连 `tsx` 跑源码）。安装到目标机器或生产环境时，跑的是 **esbuild 自包含 bundle**（`dist/bundle.mjs`）——不依赖 `node_modules`、不需要 `tsx`。

### 1. 打包

```bash
pnpm install
pnpm build            # tsc → dist/
pnpm bundle           # esbuild → dist/bundle.mjs（自包含，可直接 node 运行）
# 可选：产出可分发压缩包
pnpm package          # → dist-packages/nuwax-flow-ts-<version>-{.tgz,nuwax.tar.gz,nuwax.zip}
```

`dist/bundle.mjs` 是单文件入口，`bin.start` 指向它（见 [.nuwax-agent/agent-package.json](../../../packages/deepagents-flow-ts/.nuwax-agent/agent-package.json)）。

### 2. 安装

```bash
# 方式一：直接用本仓库（本地部署）
node <REPO>/dist/bundle.mjs          # 等价于 pnpm start

# 方式二：用分发的压缩包 —— 解压 dist-packages/*-nuwax.zip 到 <INSTALL_ROOT>
node <INSTALL_ROOT>/dist/bundle.mjs
```

复制 [.env.example](../../../packages/deepagents-flow-ts/.env.example) → `.env` 并填凭证（或由部署环境的 env 注入）。

### 3. 生产 agent_servers（连已安装的包）

调试用 `tsx <REPO>/src/index.ts`；安装后改用 `node <INSTALL_ROOT>/dist/bundle.mjs`：

```jsonc
{
  "agent_servers": {
    "flow · 生产": {
      "type": "custom",
      "command": "node",
      "args": ["<INSTALL_ROOT>/dist/bundle.mjs"],
      "env": {
        "OPENAI_API_KEY": "<YOUR_OPENAI_API_KEY>",
        "OPENAI_BASE_URL": "https://api.deepseek.com/v1",
        "OPENAI_MODEL": "deepseek-chat",
        "MAX_TOKENS": "16384",
        "LOG_LEVEL": "info",
        "LOG_DIR": "<INSTALL_ROOT>/logs"
      }
    }
  }
}
```

> `<INSTALL_ROOT>` = agent 解压后的安装根目录（含 `dist/`、`config/`、`.nuwax-agent/`）。

### 4. 调试 vs 生产 对照

| | 调试（开发） | 生产（已安装） |
|--|---|---|
| `command` | `tsx` | `node` |
| `args` | `<REPO>/src/index.ts` | `<INSTALL_ROOT>/dist/bundle.mjs` |
| 依赖 | 需 `node_modules`（`pnpm install`） | 无（esbuild 自包含） |
| `LOG_LEVEL` | `debug` | `info` |
| 凭证来源 | `env` 注入 | `.env` 或部署 env |

更多打包命令见 [scripts/README.md](../../../packages/deepagents-flow-ts/scripts/README.md)。
