# 运行时架构 (Runtime Architecture)

`packages/deepagents-app-ts` 的整体架构与运行逻辑。三层分区遵循
[CLAUDE.md](../../CLAUDE.md) 的铁律:`app/` 可编辑业务区,`runtime/` + `surfaces/`
为受保护引擎,外部为依赖。

## 1. 包架构总览

入口 `src/index.ts` 按命令分发到两个运行面(ACP / CLI),两者最终汇到同一个
`buildAgentConfig` 收口点,组装出 `DeepAgentConfig` 交给 deepagents
`createDeepAgent`;横切服务贯穿所有层。

```mermaid
flowchart TD
    idx["src/index.ts — 解析参数 / 分发<br/>acp(默认) · chat · ask/run · graph(静态码图)"]
    idx --> acp["ACP 服务器 · surfaces/acp<br/>DeepAgentsServer + 生命周期 hooks<br/>stdio ↔ nuwaclaw / Zed"]
    idx --> cli["CLI · surfaces/cli<br/>REPL · one-shot · run"]

    acp --> build["buildAgentConfig<br/>runtime/agent-config · acp/config-builder<br/>组装 DeepAgentConfig"]
    cli --> build
    app["app/ 可编辑业务区<br/>tools/* · hooks · harness-profile"] --> build
    rt["runtime 引擎输入<br/>model · prompt(+conventions)<br/>permissions · discovery(子代理/技能/记忆)"] --> build

    build --> cda["deepagents createDeepAgent → LangGraph ReAct agent<br/><br/>内置: todo · filesystem(权限/驱逐) · task/子代理 · 摘要 · 缓存 · memory · HITL<br/>app: harnessLifecycle · fsPathResolver · stuckLoop · periodic · cost · hooks"]

    cda --> model["Model · Anthropic / OpenAI"]
    cda --> mcp["MCP 服务器 · @langchain/mcp-adapters"]
    cda --> plat["Platform API · platform_api / 变量"]

    xcut["横切服务 runtime/ (贯穿所有层)<br/>storage: runtime-storage · harness-lifecycle · approvals<br/>platform: client · variable-manager · mcp-manager<br/>scheduler: action-scheduler"]
    xcut -.->|读写 / 调用| acp
    xcut -.->|读写 / 调用| cda

    classDef appzone fill:#0d9488,stroke:#0f766e,color:#ffffff
    class app appzone
```

> 青色 = `app/` 可编辑业务区;其余为受保护引擎与外部依赖。

## 2. ACP prompt 运行流 & turn 生命周期归属

一次 prompt 的判定路径。**关键不变量:agent turn 的生命周期由
`harnessLifecycle` 中间件独占("SOLE owner");ACP hooks 只负责 slash 命令与失败兜底。**
两者若同时驱动 `begin/complete/fail` 会造成计数翻倍(见
[harness-lifecycle.ts](../../src/runtime/storage/harness-lifecycle.ts) /
[session-lifecycle.ts](../../src/surfaces/acp/session-lifecycle.ts))。

```mermaid
flowchart TD
    client["ACP client"] -->|session/prompt| hp["DeepAgentsServer.handlePrompt"]
    hp --> bi{"内置 slash?"}
    bi -->|是| ret1["返回结果(短路)"]
    bi -->|否| op["onPrompt hook (app)<br/>appendRuntimeMessage · handleAcpSlashCommand"]
    op --> sl{"已识别 slash?"}
    sl -->|是| slturn["begin + complete turn<br/>(此 hook 负责) → 返回结果(短路)"]
    sl -->|否| agent["streamAgentResponse → agent 运行"]
    agent --> mw["harnessLifecycle 中间件 = turn owner<br/>beforeAgent→begin · afterAgent→complete<br/>wrapModelCall 出错→fail"]
    mw --> back["onPromptComplete / onPromptError<br/>幂等兜底(failHarnessTurn 同 turn 内只计一次)"]

    classDef owner fill:#0d9488,stroke:#0f766e,color:#ffffff
    class slturn,mw,back owner
```

> 青色 = turn 生命周期归属者。普通 prompt 不在 `onPrompt` 里开 turn,否则与中间件的
> `beforeAgent` 双开 → `counters.turns` 翻倍。

## 3. 会话生命周期时序

`session/new` 经 `configureSession` 完成 per-session 工作区切换 / MCP 转发 /
agent 重建,随后 `session/prompt` 走第 2 节的判定。

```mermaid
sequenceDiagram
    participant C as ACP client
    participant S as DeepAgentsServer
    participant H as app hooks
    participant A as LangGraph agent
    participant M as harnessLifecycle mw

    C->>S: session/new (cwd, mcpServers)
    S->>H: configureSession(phase: new)
    H-->>S: SessionConfigurePatch (workspaceRoot / agentConfig)
    S->>S: applySessionPatch → createAgent(重建)
    Note over S: handleLoadSession 同样在 patch 后<br/>重建 agent,否则下个 prompt 抛 Agent not found

    C->>S: session/prompt
    S->>H: onPrompt
    alt slash 命令
        H->>M: begin + complete turn
        H-->>S: 结果(短路)
        S-->>C: end_turn
    else 普通 prompt
        H-->>S: undefined
        S->>A: streamAgentResponse
        A->>M: beforeAgent → beginHarnessTurn
        loop 模型 / 工具循环
            A->>M: wrapModelCall · wrapToolCall
        end
        A->>M: afterAgent → completeHarnessTurn
        S->>H: onPromptComplete (幂等兜底)
        S-->>C: stopReason
    end

    C->>S: session/cancel
    S->>H: onSessionClosed → 持久化 + 清理
```

## 关键文件

| 区域 | 路径 |
|---|---|
| 入口分发 | `src/index.ts` |
| ACP 面 | `src/surfaces/acp/{server,session-lifecycle,config-builder,slash-command-handler}.ts` |
| CLI 面 | `src/surfaces/cli/{repl,one-shot}.ts` |
| 配置装配 | `src/runtime/agent-config.ts`(`buildAgentConfigParts`) |
| 引擎输入 | `src/runtime/{model,prompt,permissions,discovery}.ts` |
| app 中间件 | `src/runtime/middleware/*.ts` |
| 横切服务 | `src/runtime/storage/*`、`src/runtime/platform/*`、`src/runtime/scheduler/*` |
| app 业务区 | `src/app/{tools,hooks,harness-profile}` |

外部 deepagents / deepagents-acp 范式对齐说明见
[nuwaclaw-engine-integration.md](./nuwaclaw-engine-integration.md)。
