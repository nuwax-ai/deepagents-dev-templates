# deepagents-flow-ts — ACP 协议对齐维护手册

> 本文档已拆分为多文件，便于分层查阅与持续跟进。

## 入口

- **[development/README.md](./README.md)** — 开发文档总索引
- **[development/acp/README.md](./acp/README.md)** — ACP 子索引、快速入口、当前状态摘要

---

## 文档地图

| 文档 | 内容 |
| --- | --- |
| [acp/README.md](./acp/README.md) | 索引与维护约定 |
| [acp/spec-and-version.md](./acp/spec-and-version.md) | 官方 schema、SDK 基线 |
| [acp/architecture.md](./acp/architecture.md) | Flow vs Legacy 双路径 |
| [acp/field-mapping.md](./acp/field-mapping.md) | `tool_call` 等字段对照 |
| [acp/legacy-path.md](./acp/legacy-path.md) | `deepagents-acp` Legacy |
| [acp/dataflow-nuwaclaw.md](./acp/dataflow-nuwaclaw.md) | 端到端 + NuwaClaw 契约 |
| [acp/maintenance.md](./acp/maintenance.md) | 核对清单、源码索引 |
| [acp/roadmap-progress.md](./acp/roadmap-progress.md) | **追赶路线图与进度（持续更新）** |
| [acp/reference-implementation.md](./acp/reference-implementation.md) | claude-code-acp-ts 对照 |
| [acp/changelog.md](./acp/changelog.md) | 变更记录 |

---

## 最常打开

- 改 tool 出站 → [field-mapping.md](./acp/field-mapping.md) + [maintenance.md](./acp/maintenance.md)
- 跟进对齐进度 → [roadmap-progress.md](./acp/roadmap-progress.md)
- 对照参考实现 → [reference-implementation.md](./acp/reference-implementation.md)
