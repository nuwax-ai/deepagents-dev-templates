# Dev-Agent Flow · 迭代层（`iteration/`）

本目录 = **需求确认 / 优化目标 / 迭代方案台账** + **静态门禁**。  
**不是**交付包，**不**进入智能体开发 Agent 编排后台。

**怎么改交付配置？** 见包根 [**HOWTO.md**](../HOWTO.md)（逐步手册）。

| 角色 | 路径 |
|------|------|
| 版本清单（回朔） | [`VERSIONS.md`](VERSIONS.md) |
| 对齐基线 | [`ALIGNMENT.md`](ALIGNMENT.md) |
| 评价口径 | [`EVALUATION.md`](EVALUATION.md) |
| 迭代台账（过程） | [`ITERATION.md`](ITERATION.md) |
| 跑分记录 | [`scoreboard.md`](scoreboard.md) |
| 静态检查 | `checks/`、`cases/`、`run-static.sh` |

## 交付层（真源 · 人工同步后台）

调优并最终配进后台的是 [`../orchestration/`](../orchestration/)，不是本目录：

| 仓内交付物 | 后台字段 / 组件 |
|------------|-----------------|
| [`../orchestration/system-prompt.md`](../orchestration/system-prompt.md) | `systemPrompt` |
| [`../orchestration/user-prompt.md`](../orchestration/user-prompt.md) | `userPrompt` |
| [`../orchestration/skills/*`](../orchestration/skills/) | `type=Skill` |
| [`../orchestration/agent.manifest.json`](../orchestration/agent.manifest.json) | 期望清单（对照后台；本身不上传为组件） |

闭环：写清「本轮目标句」+ 过方向三问（[`ITERATION.md`](ITERATION.md)）→ 改 `orchestration/` → 升号写入 [`VERSIONS.md`](VERSIONS.md) → `pnpm iteration:static` → **人工同步编排页** → drift + 真实会话抽测。

开发 Agent 面向的工作目录模板是 [`deepagents-flow-ts`](../../deepagents-flow-ts)。**默认**不在本迭代层改模板；**为规则 / 能力对齐需要时可改**，变更须记入 [`VERSIONS.md`](VERSIONS.md) / [`ITERATION.md`](ITERATION.md)。

## 调优四维（检查覆盖）

| 维 | 仓内真源 | 怎么验 |
|----|----------|--------|
| 系统 / 用户提示词 | `orchestration/*.md` | `check-prompts` + `check-platform-drift` |
| 技能 | `orchestration/skills/*` | `check-skills` + drift 名集合 |
| **context7 用法** | L0 `<MCP_USAGE>` + manifest `mcp.devAgent` | `check-mcp-usage`；drift **仍绑定**两工具 |
| **ask-question 宿主用法** | L0 + manifest `hostDefaults` | `check-mcp-usage`；**不**因编排页无 `type=Mcp` 失败 |

## MCP：一律只调用法

| MCP | 归属 | Iteration |
|-----|------|-----------|
| **context7** | 编排页已挂三方（人工配置） | 何时用 / `resolve-library-id`→`query-docs` / drift 绑定 |
| **ask-question（宿主）** | NuwaClaw / rcoder 默认 | 结构化提问 vs 自由文本；**不**要求编排页再挂 |
| **ask-question（模板）** | [`mcp.default.json`](../../deepagents-flow-ts/config/mcp.default.json) | 仅核对交付配置形态；**非**开发 Agent 后台必配项 |

工具契约只读参考：[nuwax-ai/nuwax-ask-question-mcp](https://github.com/nuwax-ai/nuwax-ask-question-mcp)。

## 命令

| 命令 | 说明 |
|------|------|
| `./run-static.sh` 或 `pnpm iteration:static` | manifest / prompts / skills / mcp-usage / cases / sample drift |
| `pnpm iteration:drift -- --platform <agent-detail.json>` | 对照平台导出做四维 drift |

## 目录

```
iteration/                       # 迭代层（不下发后台）
├── VERSIONS.md                  # 交付配置回朔清单
├── ITERATION.md
├── scoreboard.md
├── README.md
├── run-static.sh
├── case.schema.json
├── cases/
├── checks/
├── fixtures/
└── lib/
```

## 明确不做

- 不把本目录打进编排后台  
- 不自动写入平台编排后台  
- 不改 MCP 本体  
- 不以目标业务 Agent E2E 作本迭代层主门禁  
- **默认**不改 [`deepagents-flow-ts`](../../deepagents-flow-ts)；对齐需要时可改，并写入 VERSIONS  
