# Part 6：子智能体（Subagent）— 平台或内置

> 所属：`flow-builder` L2-F。入口路由见 [SKILL.md](../SKILL.md)。

**禁止**写 `.agents/agents/`。合法路径：

| 路径 | 怎么做 |
|------|--------|
| **平台** | 引导用户在平台 UI 添加 |
| **项目内置** | `builtin/agents/<name>/AGENT.md`（与 `builtin/skills/` 同属 `agentsDirectories: ["./builtin", …]`） |

## 开发 Agent 应做什么

1. **不要**写 `.agents/agents/`
2. 平台需求 → 引导平台 UI
3. 须随仓库交付 → `builtin/agents/<name>/AGENT.md`
4. 更新 `project.md`

---

## 三套「工具」概念（生产易错）

| 概念 | 在哪配 | 示例 | 说明 |
|------|--------|------|------|
| 平台能力登记 | `<PLATFORM_CONFIG>.tools` | `联网搜索_1` | `add-tool` 登记名；**不是** runtime 工具名 |
| Runtime 工具名 | `bindTools` 后 | `platform__web_search_1` | LLM / `task` allowlist 只认这个 |
| Subagent allowlist | `AGENT.md` `tools:` | 同上 runtime 名 | **可选**；默认不写 |

**铁律**：

- **默认省略 `tools`** — 子 agent 继承父级工具（含当前会话的平台聚合 MCP，**不含 `task`**）；搜索 MCP 的 runtime 名由 `tools/list` 动态发现，无需写入 frontmatter
- **禁止** `tools: 联网搜索_1` 等平台登记名或中文 server 名 → 报 `配置了未知工具`
- **联网搜索**：平台登记的搜索能力运行期经聚合 MCP 下发；子 agent 可直接调用当前工具列表中已授权的搜索 MCP
- 框架 `task` 会在 AGENT.md 正文后自动追加委派约定（须非空最终结论、仅调用实际提供的工具）
- **复杂任务 Todo**：子 agent 使用内置 `write_todos` 提交完整清单快照；并行计划由 runtime 按父 `task` 的 `toolCallId` 合并，ACP 中以 `[subagent]` 前缀区分
- **简单任务不建 Todo**；更新时必须提交全部条目并推进 `pending → in_progress → completed`

---

## AGENT.md 契约

| 字段 | 建议 |
|------|------|
| `name` / `description` | 必填（路由用） |
| `model` | **省略**（继承主 Agent）；禁止 `{MODEL_PROVIDER_*}` → `400 Invalid model` |
| `workdir` | 可选，相对沙箱目录 |
| `tools` | **省略**（绝大多数场景） |

```markdown
---
name: researcher
description: "研究助手"
---
你是研究专家。根据 task 的 description 独立完成任务，返回结构化结论。
子 agent 看不到主对话历史，description 须自包含。
```

**`(subagent 无输出)` 常见根因**：

| 根因 | 处理 |
|------|------|
| 子 agent 反复调工具未到 `respond` | 确认 `description` 自包含、搜索目标明确；框架已追加委派后缀 |
| 子 agent 调 MCP 搜索 401 | 检查平台聚合 MCP 的会话 Authorization 下发与连接复用 |
| 末条 AI 仅 `tool_calls`、无文本 | runtime 已用 stream buffer + 全量 AIMessage 扫描兜底 |
| ToolMessage 空但 UI 有流式字 | 检查 `tool_call_update`；结果应以 ToolMessage 为准 |
| 并行 Todo 相互覆盖 | runtime 应按父 `task` `toolCallId` 聚合后发送完整 ACP `plan` 快照 |

**反模式**：

```yaml
tools: 联网搜索_1                    # ❌ 平台登记名
model: {MODEL_PROVIDER_DEFAULT_MODEL}  # ❌ 未替换占位符
```

---

## Supervisor 编排

```
主 Agent 联网/MCP 检索 → 摘要写入 task.description
→ task({ subagent_type, description }) → 读 ToolMessage 结果 → 整合交付
```

- **并行多岗**：runtime 用 ACP `messageId=subagent:<name>:<toolCallId>` 分桶流式预览；**主 Agent 可并行 `task`**
- **勿**在 `task` 未完成时断言「subagent 无输出」——以 ToolMessage 返回值为准

排障 → [part4a-verify-debug.md](part4a-verify-debug.md) § Subagent。

---

## checklist

- [ ] 未写入 `.agents/agents/`
- [ ] 内置 subagent 在 `builtin/agents/`
- [ ] `AGENT.md` 无 `tools` / 无 `model` 占位符
- [ ] 联网任务已登记平台搜索能力，运行期聚合 MCP 的 `tools/list` 可见搜索工具
- [ ] smoke/ACP：`task` 至少一次成功（非 `Error:` / 非 `(subagent 无输出)`）
