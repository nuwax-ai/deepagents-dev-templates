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

- **默认省略 `tools`** — 子 agent 继承父级工具集（含 MCP，**不含 `task`**）
- **禁止** `tools: 联网搜索_1` 等平台登记名或中文 server 名 → 报 `配置了未知工具`
- **联网搜索**：主 Agent 调 MCP，把摘要写入 `task.description`；子 agent 不单独配搜索 Plugin

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

- **并行多岗**：同一轮 **禁止** 发多个 `task` 并期望 UI 逐字流式（会混流）；改**串行** `task`
- **勿**在 `task` 未完成时断言「subagent 无输出」——以 ToolMessage 返回值为准

排障 → [part4a-verify-debug.md](part4a-verify-debug.md) § Subagent。

---

## checklist

- [ ] 未写入 `.agents/agents/`
- [ ] 内置 subagent 在 `builtin/agents/`
- [ ] `AGENT.md` 无 `tools` / 无 `model` 占位符
- [ ] 联网由主 Agent 完成，结果在 `description` 里
- [ ] 多岗委派用串行 `task`
- [ ] smoke/ACP：`task` 至少一次成功（非 `Error:`）
