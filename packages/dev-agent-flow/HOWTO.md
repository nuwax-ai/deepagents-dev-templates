# HOWTO：怎么迭代修化开发 Agent 配置

本说明只回答一件事：**如何改好并发布 `orchestration/`（智能体开发 Agent 编排配置）**。

```text
痛点 → 目标句 + 方向三问 → 改 orchestration/ → VERSIONS 升号
     → pnpm iteration:static → 人工同步编排后台 → drift + 真实会话抽测
```

---

## 1. 两个目录别混

| 目录 | 是什么 | 你要做什么 |
|------|--------|------------|
| [`orchestration/`](orchestration/) | **交付真源**（开发 Agent 真正吃的配置） | **修化改这里** |
| [`iteration/`](iteration/) | 工单 + 质检 + 回朔清单（**不下发**后台） | 记账、跑检查，**不代替改配置** |

仓内改完后，仍须**你自己**把 `orchestration/` 内容贴进平台「智能体开发 Agent」编排后台。本仓库**不会**自动下发。

---

## 2. 改哪里（对照表）

| 你想改的行为 | 改哪个文件 |
|--------------|------------|
| 铁律、收工门禁、改图判定、沟通方式、MCP 用法 | [`orchestration/system-prompt.md`](orchestration/system-prompt.md) |
| 会话怎么启动 | [`orchestration/user-prompt.md`](orchestration/user-prompt.md) |
| 图怎么做 / 验证怎么走 | [`orchestration/skills/flow-builder/`](orchestration/skills/flow-builder/) |
| 平台配置读写、搜工具、登记 | [`orchestration/skills/dev-engineer-toolkit/`](orchestration/skills/dev-engineer-toolkit/) |
| 真实链路调试、HITL、日志 | [`orchestration/skills/flow-debugger/`](orchestration/skills/flow-debugger/) |
| 「后台应有什么」期望清单 | [`orchestration/agent.manifest.json`](orchestration/agent.manifest.json) |

工作目录模板 [`deepagents-flow-ts`](../deepagents-flow-ts)：**默认不动**；只有和开发 Agent 规则/能力**对齐需要**时才改，并记进版本清单。

---

## 3. 一轮迭代怎么走（逐步）

### 步骤 A — 定方向（先写字）

打开 [`iteration/ITERATION.md`](iteration/ITERATION.md)，复制「模板」新建一节，先填：

1. **本轮目标句**（写不出就停）：  
   `开发者做 X 时，开发 Agent 应 Y，用 Z 验证。`
2. **方向三问**（全过再动手）：  
   - 打中的是开发者痛点，不是「再润色一段」？  
   - 同步后台后开发 Agent 能立刻用上？  
   - 回朔路径写得清？

细则见 [`iteration/ALIGNMENT.md`](iteration/ALIGNMENT.md) § 如何确认迭代方向对。

### 步骤 B — 改交付

只改上表里的 `orchestration/`（及按需的模板）文件。  
**不要**指望改 `iteration/` 里的 md 就能改变开发 Agent 行为。

### 步骤 C — 记账回朔

在 [`iteration/VERSIONS.md`](iteration/VERSIONS.md) **置顶**追加 `iter-X.Y.Z`：摘要、改了哪些路径、怎么回朔、后台是否已同步。

### 步骤 D — 静态门禁

在包目录执行：

```bash
pnpm iteration:static
```

通过 = 分区 / 技能 / MCP 用法契约自洽。  
**绿不等于方向对**，还要做步骤 F。

### 步骤 E — 人工同步后台

把变更贴进平台编排页，例如：

- `system-prompt.md` → `systemPrompt`
- `user-prompt.md` → `userPrompt`
- 各 skill → `type=Skill` 组件

（按你现网后台操作习惯复制即可。）

### 步骤 F — drift + 抽测

```bash
pnpm iteration:drift -- --platform /path/to/agent-detail.json
```

再开真实开发会话，看目标句里的 **Y** 有没有出现。

### 步骤 G — 结论

在 `ITERATION.md` 本轮节写结论；`scoreboard.md` 可记一行跑分。

---

## 4. 怎么回朔

1. 打开 [`iteration/VERSIONS.md`](iteration/VERSIONS.md) 找到目标 `iter-*`。  
2. 按条目里的文件清单还原，例如：

```bash
git checkout <commit> -- packages/dev-agent-flow/orchestration
```

3. 再跑 `pnpm iteration:static`，并**重新同步后台**（仓内回朔不会自动改平台）。

---

## 5. 最小例子

**痛点**：开发 Agent 乱报「完成」。

1. 目标句：开发者收工时，开发 Agent 应按 `<SESSION_CLOSE>` 矩阵验证，用「未附验证证据不得写完成」检查。  
2. 改 `orchestration/system-prompt.md` 的 `<SESSION_CLOSE>` / `<OUTPUT_FORMAT>`。  
3. `VERSIONS` 升号 → `iteration:static` → 贴后台 → 真实会话试一次收工话术。

---

## 6. 相关入口

| 文档 | 用途 |
|------|------|
| [`HOWTO.md`](HOWTO.md) | **怎么用 / 怎么迭代**（你正在读的） |
| [`README.md`](README.md) | 包总览、与模板关系 |
| [`iteration/README.md`](iteration/README.md) | 迭代层目录与检查命令 |
| [`iteration/ITERATION.md`](iteration/ITERATION.md) | 当轮过程台账模板 |
| [`iteration/VERSIONS.md`](iteration/VERSIONS.md) | 版本回朔清单 |
| [`iteration/ALIGNMENT.md`](iteration/ALIGNMENT.md) | 功能与规则对齐基线 |
