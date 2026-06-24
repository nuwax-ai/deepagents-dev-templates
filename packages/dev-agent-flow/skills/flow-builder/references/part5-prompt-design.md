# Part 5：目标 Agent 提示词设计

> 所属：`flow-builder` L2-E。入口路由见 [SKILL.md](../SKILL.md)。
> **写什么**在本层；**怎么存**走 `dev-engineer-toolkit`（`update-config.sh --system-prompt-file` + `get-config.sh` 回读）。

为基于 `deepagents-flow-ts` 开发的**业务 Agent** 设计系统提示词 / 开场白。产出的是目标 Agent 运行时读取的提示词，不是开发 Agent 自身提示词。

## 核心原则

1. **结构化 > 自由发挥** — 覆盖「七要素」，不即兴空写。
2. **few-shot 是质量分水岭** — 有固定格式/语气/结构时，**必须** ≥1 个「输入 → 期望输出」示例。
3. **存平台不硬编码** — 经 `dev-engineer-toolkit` 保存；禁止写进 `src/runtime/` 或节点代码。
4. **保存即回读** — `get-config.sh --key systemPrompt` 确认非空且为新值。
5. **只改一字段就省略另一字段** — 勿传空开场白/系统提示词覆盖原值。
6. **工具名与配置一致** — 提示词里点名的工具须是 `dev-engineer-toolkit` 已 `add-tool.sh` 注册的同一项。

## 设计流程（6 步）

| 步 | 动作 |
|----|------|
| 1 | 场景识别（用户、输入输出、工具/知识库） |
| 2 | 选场景模板（A–D 或通用七要素） |
| 3 | 填充七要素 + **至少 1 个 few-shot** |
| 4 | 过 checklist |
| 5 | `dev-engineer-toolkit`：`update-config.sh --system-prompt-file` / `--opening-msg-file` |
| 6 | `get-config.sh` 回读校验 |

与 scaffold 衔接：写好后填入 [part1-scaffold.md](part1-scaffold.md) 的 `systemPrompt`（若该拓扑注入 prompt）。

## 七要素骨架

```markdown
# [Agent 名] — [领域] 助手

你是 **[角色]**，服务 **[目标用户]**，专注 **[场景]**。

## 核心能力
- [能力1，动词开头，具体]（3–5 条）

## 工作方式
理解需求 → 按需调工具 → 观察结果 → 回答；不足则查或问，不臆测。

## 工具使用
- [工具A]：场景 + 入参（名须与平台配置一致）

## 领域知识与约束
- [规则 / 边界 / 禁区]

## 输出规范
- 格式 / 语气 / 长度

### 示例（few-shot）
输入：…
输出：…

## 兜底
- 信息不足 / 超范围如何处理
```

## 场景模板库

| 模板 | 特征 | 要点 |
|------|------|------|
| **A 客服+RAG** | 知识库问答、引用来源 | 先检索再答；检索到/不到各 1 few-shot |
| **B 内容生成** | 风格化文案、固定结构 | 完整「主题→成品」few-shot；标题/标签规范 |
| **C 数据分析** | SQL/看板、结论解读 | 先确认口径；SQL 契约写 `project.md` |
| **D 任务工具型** | 意图→工具→结果 | 副作用操作前确认；工具调用 few-shot |

## checklist（保存前）

- [ ] 角色/用户/场景一句说清
- [ ] 能力 3–5 条具体；工具名已配置
- [ ] ≥1 few-shot（有固定格式时）
- [ ] 有兜底；无矛盾指令
- [ ] 已保存并 `get-config.sh` 回读

## Anti-patterns

- ❌ 只有空泛角色能力，无工具指引/few-shot/输出规范
- ❌ 未配置工具名写进提示词
- ❌ 硬编码进代码；保存不回读
- ✅ 七要素 + few-shot → `dev-engineer-toolkit` 保存 → 回读 → 填 scaffold spec（如需）
