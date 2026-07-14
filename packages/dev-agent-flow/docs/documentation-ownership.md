# 文档权责与去重规则

本文件定义 `dev-agent-flow` 与目标模板 `deepagents-flow-ts` 的单一权威源，防止开发 Agent 的常驻提示词、Skill 与模板文档各自维护同一条规则。

## 权责表

| 内容 | 唯一权威正文 | 其他载体允许保留的内容 |
|---|---|---|
| 模板架构、目录、配置路径、命令、运行时行为、术语、图规则、验证矩阵 | 目标项目 `README.md` 与 `docs/` | 何时读取、链接与不超过一句的安全护栏 |
| 开发 Agent 的身份、Skill 路由、平台配置边界、平台回读与对外汇报门禁 | `orchestration/system-prompt.md` | 指向该提示词的链接 |
| 图选型、平台登记、调试、提示词同步、子智能体与 Skill 的操作步骤 | 对应 `orchestration/skills/*/references/` | 路由到具体 Part，不复制步骤 |
| 开发 Agent 配置的版本、评估、平台 drift | `iteration/` | 不下发到平台 |

## 写作规则

1. 一条可执行事实或规则只保留一个可编辑正文；其他位置只能引用其来源。
2. `system-prompt.md` 不是模板说明书：不得复制目录表、default/改图判定表、factory 速查、图规则或工程验证矩阵。
3. Skill 不是模板 API 镜像：步骤可以引用模板文档，但不得重述 `docs/flow-graph-rules.md`、`docs/node-kit.md` 或 `docs/examples.md` 的完整规则表。
4. 需要常驻保护时，只写行为性护栏，例如“先读取权威文档”“平台字段必须回读”；不复制技术细节。
5. 开发 Agent 的行为策略可以收窄模板支持的选项，但必须明确标成“交付策略”，不得伪装成模板能力限制。例如模板运行时支持 `.agents/` 扩展，而本开发 Agent 统一交付到 `builtin/` 或平台侧。
6. 修改一项规则时，先修改其权威正文，再检查所有引用是否仍准确；不要以同步复制文本的方式修复漂移。

## 开发 Agent 的读取顺序

开发 Agent 开始任务时先读取目标项目的 `README.md` 与 `docs/README.md`；再按任务读取 `docs/examples.md`、`docs/flow-graph-rules.md`、`docs/node-kit.md` 等权威文档。需要施工流程时才加载相应 Skill Part。

本文件由 `iteration/checks/check-document-ownership.py` 校验：系统提示词必须保留权威文档入口，并且不得恢复已移除的模板规则分区。
