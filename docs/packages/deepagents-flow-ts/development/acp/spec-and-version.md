# 规范来源与版本

[← 返回索引](./README.md)

---

## 官方 Schema 仓库（唯一权威来源）

协议 JSON Schema 维护在官方 monorepo：

- **根目录**：[agentclientprotocol/agent-client-protocol — schema/](https://github.com/agentclientprotocol/agent-client-protocol/tree/main/schema)
- **稳定 v1**：[schema/v1/schema.json](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v1/schema.json)（`meta.json` → `"version": 1`）
- **稳定 v2**：[schema/v2/schema.json](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v2/schema.json)（演进中；`auth/login` 等方法与 v1 不同，见 [v2/meta.json](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v2/meta.json)）
- **不稳定扩展**：[schema/v1/schema.unstable.json](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v1/schema.unstable.json)
- **方法名映射**：[schema/v1/meta.json](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v1/meta.json)（`session/new` → `session_new` 等）

人类可读说明：[agentclientprotocol.com](https://agentclientprotocol.com)

> 本地对比时，建议将 v1 `schema.json` 拉到仓库外或旁路目录，**不要**提交进模板包分发内容：
>
> ```bash
> curl -fsSL -o /tmp/acp-schema-v1.json \
>   https://raw.githubusercontent.com/agentclientprotocol/agent-client-protocol/main/schema/v1/schema.json
> ```

---

## 本仓库应对齐哪一版

| 项 | 当前基线 | 说明 |
| --- | --- | --- |
| **Schema 代数** | **v1** | 与 `@agentclientprotocol/sdk@0.24.x` / NuwaClaw 宿主一致 |
| TypeScript SDK | `@agentclientprotocol/sdk@^0.24.0` | [package.json](../../../../../packages/deepagents-flow-ts/package.json) |
| Vendored 层 | `libs/deepagents-acp`（源自 deepagents-acp 0.1.3） | `@ts-nocheck`；类型与 SDK 有漂移，见 [legacy-path.md](./legacy-path.md) |
| **参考实现** | [**nuwax-ai/claude-code-acp-ts**](https://github.com/nuwax-ai/claude-code-acp-ts)（本地：`~/workspace/claude-code-acp-ts`） | NuwaX fork；与 NuwaClaw 同源；详见 [reference-implementation.md](./reference-implementation.md) |

---

## 升级 SDK 或换 schema 时

1. 先读 [schema/v1/CHANGELOG.md](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v1/CHANGELOG.md)（或 v2）
2. diff `ToolCall`、`ToolCallUpdate`、`ContentChunk`、`Plan`、`SessionUpdate` 的 `$defs`
3. 对照参考实现的 `acp-agent.ts` / `tools.ts`（见 [reference-implementation.md](./reference-implementation.md)）
4. 按 [maintenance.md](./maintenance.md) 清单 + [roadmap-progress.md](./roadmap-progress.md) 更新进度 + `tests/acp-emit-tool-call.test.ts` 回归
