# 示例：项目管理（project manager）

把目标拆成任务、估时排期、**评估计划是否完备（不完备就重规划）**，最后**人工审批**——
体现"分解-执行-评估循环 + HITL"这类需求（对比 RAG 的线性检索、travel 的并行、human-in-loop 的纯审）。

对应 LangGraph 官方：**Reflection / evaluator-optimizer** + **Branching（条件边）** + **Human-in-the-loop**。

## 图

```
START → plan → estimate → evaluate ─(条件边)─ 不完备 & 未达上限 → plan(重规划)
                                   └ 否则 → approve(interrupt 审批) → finalize → END
```

| 节点 | 职责 | 看点 |
|---|---|---|
| `plan` | **真调 LLM**把目标拆成任务；重规划轮把上一轮评审意见喂回去改进 | **reflection（带反馈重做）** |
| `estimate` | **真调 LLM**给每个任务估时（"执行"步骤） | — |
| `evaluate` | **真调 LLM**评审完备性，写 `decision` + `critique` | **reflection（评判）** |
| `routeAfterEvaluate` | 不完备 & 未达上限 → 回 `plan`；否则 → `approve` | **纯函数条件边 + 上限** |
| `approve` | `interrupt` 暂停，请人审批 | **HITL** |
| `finalize` | 批准→确定性甘特排期；否则**真调 LLM**按意见改 | — |

> 评估循环用条件边**回边**实现，`MAX_REPLAN` 封顶防死循环——和默认图的 reflect 循环同构，
> 但这里 evaluate 评的是"产物是否达标"（evaluator-optimizer），而非"要不要再调工具"。

## 它如何用模板的 seam

`createPMFlow()` 返回 **`StatefulFlow`**（因 approve 的 interrupt）：`run({query})`→评估循环跑到审批
interrupt、`run({resume})`→finalize。surface（acp/cli）plumbing 完全复用。

## 运行

```bash
pnpm --filter deepagents-app-ts build

pnpm --filter deepagents-flow-ts exec tsx examples/project-manager/index.ts plan "做一个落地页"
pnpm --filter deepagents-flow-ts exec tsx examples/project-manager/index.ts plan -i
pnpm --filter deepagents-flow-ts exec tsx examples/project-manager/index.ts          # ACP 服务
```

CLI 跑到计划会**暂停等你**批准/提意见（同一终端继续输入）。

> **真实接入（无 demo fallback）**：`plan`/`estimate`/`evaluate`/`finalize` 真调大模型，需在 `.env` 配模型凭证
> （没配会直接报错而非降级）。`routeAfterEvaluate`（评估循环条件边）仍是纯函数——决策可单测、`MAX_REPLAN` 封顶防死循环。
> evaluate 把 `critique` 喂回 plan 形成真正的 reflection 循环：是否重规划由 LLM 评审结果决定。

## 测试

[tests/pm.test.ts](tests/pm.test.ts)：**纯函数**条件边决策表（`routeAfterEvaluate` + `MAX_REPLAN`，无凭证恒跑）；
**真实接入**用例（`skipIf` 无凭证）跑 LLM 评估循环 + interrupt→resume。
