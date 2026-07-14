# Prompt / Skill 评价口径

本文件用于评价 `dev-agent-flow` 的提示词与技能是否“写得好”，以及相对旧版本好在哪里。它属于迭代层，不下发编排后台。

## 结论先行

当前版本的主要进步不是“文案更顺”，而是把开发 Agent 的行为从提示建议变成了可路由、可验证、可回朔的工作系统：

1. **决策更少误触发**：先判定 `default` 是否够用；说不清为什么不够就不改图。
2. **上下文更省**：L0 系统提示词管铁律，L1 `SKILL.md` 管路由，L2 `references/part*.md` 管步骤。
3. **完成标准更硬**：工程验证范围由模板 README 矩阵确定，平台回读与对外完成门禁由 `<SESSION_CLOSE>` 确定；`pnpm flow` 明确不能冒充端到端。
4. **平台边界更清**：平台配置、平台工具、技能登记都必须经 `dev-engineer-toolkit`，禁止手写等价替代。
5. **调试证据更强**：平台真实链路由 `flow-debugger` 负责，要求 SSE 与 runtime 日志双证。
6. **迭代更可审计**：`orchestration/` 是交付真源，`iteration/` 是台账、drift 与静态门禁。

## 评分表

每项 0-2 分：0 = 没覆盖或容易误导；1 = 有覆盖但不够可执行；2 = 明确、可执行、有验证或路由。

| 维度 | 好的标准 | 当前证据 | 分 |
|------|----------|----------|----|
| 任务判定 | 能阻止不必要改图，先走最低成本路径 | 目标项目 `docs/examples.md` 权威判定；L0 + `flow-builder` Part0 路由 | 2 |
| 边界清晰 | 能区分开发 Agent / 目标 Agent / 平台配置 / 工作区文件 | `<TEMPLATE_IDENTITY>`、`<PLATFORM_CONFIG>`、`<AGENT_INTENT_DISAMBIGUATION>` | 2 |
| 渐进披露 | 常驻上下文只放铁律，细节按需加载 | L0/L1/L2 分层；`flow-builder` 每次只开一个 Part | 2 |
| 工具纪律 | 平台能力先搜索登记，再读取真实 schema / 工具名 | `dev-engineer-toolkit` + Part3 + `get-config --key tools --full` | 2 |
| 完成门禁 | 不同改动有不同验证标准，不能偷换“完成” | 模板 README 工程验证矩阵 + `<SESSION_CLOSE>` 平台门禁 + `flow-debugger` 证据要求 | 2 |
| 可回朔 | 能说明某次改动目标、文件、验证、后台同步状态 | `ITERATION.md`、`VERSIONS.md`、`scoreboard.md` | 2 |
| 防漂移 | 能校验仓内交付物和平台期望是否一致 | `agent.manifest.json` + `iteration/checks/*` + sample drift | 2 |
| 术语一致 | 避免 persona / prompt / skill / subagent 混用 | 术语统一到 `docs/glossary.md`，系统提示词使用“目标 Agent 系统提示词” | 2 |

当前按仓内证据可评 **16 / 16**。这不是说没有改进空间，而是说核心质量维度已经有明确机制承接。

## 与旧版本相比好在哪里

### 1. 从“大 prompt”变成“分层操作系统”

对照 `25735264 refactor(dev-agent-flow): slim system-prompt, move steps to flow-builder`：旧版把大量工作步骤放在系统提示词里，容易占用常驻上下文，也容易让模型把“规则”和“施工细节”混在一起。现在：

- `system-prompt.md` 保留身份、边界、路由、门禁。
- `flow-builder/SKILL.md` 只做 L1 路由。
- 具体施工步骤在 `references/part*.md`。

评价意义：上下文预算更稳定，模型更容易先选对路径，再加载正确细节。

### 2. 从“先搭脚手架”变成“先判定 default 是否够用”

旧版有明显 scaffold-first / preset topology 倾向；当前版本把“默认不改图”前置成第一决策：

- 开放追问、客服、通用助手、搜索总结优先 `flow.active: "default"`。
- 只有固定阶段、Send 并行、多源聚合、条件重试、multi-turn HITL 才改图。

评价意义：减少过度工程，开发 Agent 更像一个会判断成本的工程师，而不是遇事就生成图。

### 3. 从“本地 smoke”变成“平台真实链路 + 日志双证”

对照 `e3493181 feat(flow): add flow-debugger skill and retire local pnpm smoke` 之后的演进：当前完成口径不再依赖本地 CLI 的单点成功，而是把平台真实执行、工具调用断言、runtime 日志分析纳入门禁。

评价意义：能发现“本地能跑但平台没挂工具 / 会话没续上 / 日志报错”的问题，完成声明更可信。

### 4. 从“工具怎么接靠经验”变成“平台能力先登记、再固化 schema”

当前规则要求平台能力先通过 `dev-engineer-toolkit` 搜索和登记，再用回读结果确定真实工具名与 schema。并明确禁止：

- 为已登记能力手写 `fetch` / `tool()` 包装。
- 未搜平台就写外部能力。
- 用“用户后续配置”代替登记完成。

评价意义：减少幻觉工具名、错 schema、平台与代码不一致。

### 5. 从“交付文件平铺”变成“交付层 / 迭代层分离”

对照 `e926e416 refactor(dev-agent-flow): split orchestration delivery from iteration harness`：当前结构把后台真源和本地门禁分开：

- `orchestration/`：人工同步后台的 prompts / skills / manifest。
- `iteration/`：目标句、版本清单、静态检查、drift fixture、跑分记录。

评价意义：既能保持交付物干净，又能保留评审、验证和回朔证据。

## 怎么判断下一次改得更好

一次 prompt / skill 改动不应只问“读起来是不是更顺”，应至少回答这些问题：

1. **是否减少错误路径？** 例如更少误改图、更少误写 `.agents/`、更少把 `pnpm flow` 当端到端。
2. **是否降低上下文成本？** 规则是否留在 L0，细节是否移到对应 Part。
3. **是否增加可验证性？** 是否有 manifest / check / case / drift / debugger 证据承接。
4. **是否减少人工解释？** 开发 Agent 是否能自己从路由表知道下一步读哪个 skill/reference。
5. **是否更贴近真实失败？** 规则是否来自平台调试、日志、工具名、编码、HITL 等真实问题。
6. **是否可回滚？** `VERSIONS.md` 是否写清文件、验证与后台同步状态。

## 不好的信号

出现下面情况，即使文案变长、语气更强，也不算变好：

- 把 Part 里的施工细节复制回 `system-prompt.md`，导致 L0 膨胀。
- 新增规则但没有触发条件、执行位置或验证方式。
- 用更绝对的措辞替代可执行门禁。
- 同一件事在 system-prompt、Skill、README 里各说一套。
- 静态检查绿，但没有覆盖本轮目标句。
- 把平台真实链路问题降级成本地 CLI 成功。

## 推荐评审输出格式

```markdown
结论：这轮是 / 不是实质提升。

提升点：
- 行为路径：从 __ 变成 __，减少 __ 风险。
- 上下文：从 __ 变成 __，降低 __ 成本。
- 验证：新增 / 强化 __，能证明 __。

不足：
- __ 仍缺少验证 / 路由 / 单一权威。

证据：
- 文件：...
- 命令：...
- 历史对照：...
```
