# v0.2.0 Feature Verification via Zed ACP

> 配套 `zed-acp-setup.md`：先用那个文档把 ACP server 接到 Zed，再按本文档逐项验证 v0.2.0 的新功能。

本文档面向通过 Zed ACP client 调试本模板的开发者。每个场景给出一组提示词 + 预期行为 + 验证手段。验证基线是 `examples/thesis-ppt`（一个独立的、可读写的 Node 项目，最适合做"真实但隔离"的测试目标）。

## 前置准备

1. 在 Zed 中打开 `examples/thesis-ppt`（不是 packages/template 本身 — 用独立项目做目标，避免被保护区机制干扰验证）。
2. 确认 `~/.config/zed/settings.json` 中 `agent_servers.deepagents-template` 的 `args` 指向当前工作树的 `src/index.ts`（Zed 用 `tsx` 跑源码，dist 不存在也无所谓）。
3. **重启 Zed 或 reload agent server** — Zed 不会自动重新加载 ACP server 进程。
4. 打开一个终端 tab 便于 `cat` / `ls` 文件系统状态。`LOG_DIR` 指向 `/Users/apple/workspace/deepagents-dev-templates/logs` 时日志落盘，模型出错时第一个看的地方。
5. **Sanity check 保护区文件** — 在跑任何场景前，verify `packages/template/src/runtime/acp-server.ts` 第 1 行仍是 `/**`，不是 `// HACK` 之类的人为改动。`git status packages/template/src/runtime/` 应当是 clean。这一步保证你从干净基线开始验证，否则保护区测试可能因为已经被改过的文件混淆视听。

## 1 分钟快速烟测

如果只想跑 1 分钟确认整套基础设施活着，依次发 3 个 prompt：

1. **生命周期可读**：
   ```
   用 runtime_info 工具看 lifecycle，includeLifecycle 设为 true，告诉我 turns 和 phase。
   ```
   预期：`phase: "idle"`，`counters.turns >= 1`，`currentTurn.inputPreview` 含本轮 prompt 的前 500 字。

2. **文件读取 OK**：
   ```
   读 examples/thesis-ppt/README.md 第 1 段告诉我主要内容。
   ```
   预期：返回关于"大学毕业论文答辩 PPT 生成"的内容。

3. **文件编辑 OK**：
   ```
   把 examples/thesis-ppt/src/ppt-builder.ts 第 1 行加一个空行。
   ```
   预期：`edit_file` 工具被调用，Zed 不弹权限弹窗（`DEEPAGENTS_PERMISSIONS_MODE=ask` + `client.autoApprove=true`），文件实际修改。

三个全过 = v0.2.0 的 harness 跟踪、工具沙箱、agent 流程都在工作。

---

## 场景 1 — Sandbox profile：拒绝写 `src/runtime/`

**目的**：验证 workspace-write profile（默认）通过 protected-paths middleware 阻断对 `src/runtime/` 的写入。

**提示词**：
```
读 examples/thesis-ppt/src/ppt-builder.ts，然后在 examples/thesis-ppt/src/runtime/test.ts 写一个 hello world 函数。
```

**Zed 中观察**：
- `tool_call` (read) for `ppt-builder.ts`
- `tool_call` (write) for `examples/thesis-ppt/src/runtime/test.ts` — 成功（这是 example 项目的 `src/`，不在保护区）
- 出现 `agent_message_chunk` 解释文件已创建

**正向验证**：
```bash
ls examples/thesis-ppt/src/runtime/test.ts
cat examples/thesis-ppt/src/runtime/test.ts
```
应该存在且含 "hello world"。

**反向验证（保护区测试）**：
```
把 packages/template/src/runtime/acp-server.ts 的第一行改成 // HACK。
```
预期：agent 拒绝执行（或返回失败），`harness-lifecycle.json` 的 `lastError` 含 "permission denied"，`packages/template/src/runtime/acp-server.ts` 第一行保持 `/**` 不变。

---

## 场景 2 — Harness lifecycle counters 真实累加

**目的**：验证 `createHarnessLifecycleMiddleware` 的 `beforeAgent` / `afterAgent` / `wrapModelCall` 钩子真的被调用，`counters.turns` 等会随 prompt 真实累加。

**步骤**：

1. 发 3 个连续 prompt（任何内容都行）：
   ```
   第一轮的 prompt
   ```
   ```
   第二轮的 prompt
   ```
   ```
   第三轮的 prompt
   ```

2. 第 4 个 prompt 查询 lifecycle：
   ```
   用 runtime_info 工具查 lifecycle，includeLifecycle: true。
   ```

**预期输出**（节选）：
```json
{
  "phase": "idle",
  "busy": false,
  "counters": { "turns": 4, "modelCalls": 4, "toolCalls": 1, "failedTurns": 0 },
  "currentTurn": {
    "index": 4,
    "inputPreview": "用 runtime_info 工具查 lifecycle，includeLifecycle: true。",
    "startedAt": "...",
    "endedAt": "..."
  }
}
```

**文件系统交叉验证**：
```bash
cat ~/.deepagents/workspaces/*/sessions/*/harness-lifecycle.json | python3 -m json.tool
```
JSON 内容应与 `runtime_info` 输出一致（同一份数据，磁盘 + 工具）。

---

## 场景 3 — 触发 LLM 摘要（compaction + summarizerModel）

**目的**：验证 `generateSummary` 真的会调 LLM（不是占位），并展示 `compaction.summarizerModel` 的覆盖能力。

**Step 1 — 把 compaction 阈值调小**（默认 `contextWindow: 200_000`，触发太慢）：

```bash
# 在 examples/thesis-ppt 目录下编辑一个临时 config，覆盖模板 config
cat > /tmp/test-config.json <<'EOF'
{
  "$schema": "./config-schema.json",
  "agent": { "name": "compaction-test", "description": "test", "version": "0.2.0" },
  "model": { "provider": "anthropic", "name": "claude-sonnet-4-6" },
  "middleware": { "compaction": { "enabled": true, "contextWindow": 50000, "triggerThreshold": 0.5 } }
}
EOF
```

启动 agent server 时用 `--config /tmp/test-config.json`（或在 Zed settings.json 改 `args`）。

**Step 2 — 喂长 prompt**：
```
把 examples/thesis-ppt/src/thesis-data.ts 每章的章节标题改写成超长超详细描述，加上大量细节、人物、地点、年代、背景、引用、研究方法、结果分析、局限性、未来工作、参考文献等等，目标是这个文件超过 50k tokens。
```

agent 会反复 `edit_file` 让文件膨胀。等停。

**Step 3 — 继续加压**：
```
每个章节下面加 10 段详细文字，每段至少 200 字。
```

**Step 4 — 查 lifecycle 状态**：
```
runtime_info 工具 includeLifecycle: true。
```

**预期**：`counters.modelCalls` 持续增长。`currentTurn.inputPreview` 显示最近一轮 prompt。**如果 context 真的溢出，agent 仍然能继续运行**（说明 summarization 兜底了）；harness-lifecycle.json 不会变 broken。

**Step 5 — 验证 summarizerModel 覆盖**（可选）：

```bash
# app-agent.config.json 加一行 compaction config
```
```json
"middleware": {
  "compaction": {
    "enabled": true,
    "contextWindow": 50000,
    "triggerThreshold": 0.5,
    "summarizerModel": "claude-haiku-4-5"
  }
}
```

重启 agent，重新跑 Step 2-4。日志里 `Effective env vars` 不会有变化（因为 `summarizerModel` 不是 env var），但每次触发 compaction 时，bootstrap 内部的 `resolveSummarizerModel` 会用 Haiku 而不是 Sonnet。

---

## 场景 4 — OpenAI 兼容协议

**目的**：验证 `acp-verify.ts` 同款的 `LLM_PROVIDER=openai` 路径在 Zed 中也工作。

**改 `~/.config/zed/settings.json`**：
```json
{
  "agent_servers": {
    "deepagents-template": {
      "type": "custom",
      "command": "node",
      "args": ["--import", "tsx", "/path/to/packages/template/src/index.ts"],
      "env": {
        "LLM_PROVIDER": "openai",
        "OPENAI_MODEL": "deepseek-v4-pro",
        "OPENAI_BASE_URL": "https://api.deepseek.com/v1",
        "OPENAI_API_KEY": "sk-...",
        "MAX_TOKENS": "16384",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

重启 Zed。

**提示词**：
```
读 examples/thesis-ppt/package.json 告诉我 version。
```

**预期**：
- agent 正常返回 `"1.0.0"`
- bootstrap 日志（`LOG_DIR` 下的 stderr）显示 `id: ["langchain", "chat_models", "openai", "ChatOpenAI"]`
- 没有 `instanceof AIMessage` 错误（这个错误在 v0.2.0 之前因为 `@langchain/openai@0.5.x` 锁了 `@langchain/core@0.3.x` 出现，已修）

**反向**（Anthropic 回切）：把 `LLM_PROVIDER` 设回 `anthropic`，重启，再发同样 prompt，应当走 `ChatAnthropic` 路径。

---

## 场景 5 — Scenario Agent Spec 生成

**目的**：验证 `skills/builtin/agent-requirement-to-spec/SKILL.md` + `prompts/target-agent.base.md` + `.nuwax-agent/agent.spec.example.json` 三件套的端到端工作。

**提示词**（用 `docs/scenario-agent-examples.md` Example 1）:
```
做一个客服 Agent，能看工单、判断优先级、追问缺失信息，并给出回复草稿。
```

**预期**：
- agent 读 `.nuwax-agent/agent.spec.example.json` 找模板
- 读 `skills/builtin/agent-requirement-to-spec/SKILL.md` 取 pattern
- 询问 1-3 个澄清问题（"工单数据来自哪个 MCP 或 API?" 等，agent-core-progress.md 中提示过只问架构变更类的问题）
- 输出符合 `nuwax.agent.spec.v1` 的 JSON spec

**Zed 中观察**：
- 出现 3-5 个 `tool_call`（多个 `read_file` + 1 个 `write_file` 写 spec）
- agent_message_chunk 输出 JSON spec

---

## 场景 6 — Durable session load（kill + 恢复）

**目的**：验证 `runtime-storage.ts` 把 session 状态持久化到磁盘，重启后 metadata 仍可读。

**Step 1** 创建 session：
```
把 examples/thesis-ppt/src/ppt-builder.ts 第 50 行附近的字体设置注释一下。
```

记录 session id（Zed UI 显示，或终端 `cat ~/.deepagents/workspaces/*/sessions/*/metadata.json | jq -r .sessionId`）。

**Step 2** 关闭 agent：Zed 里点 disconnect，或终端 `pkill -f "tsx.*src/index.ts"`。

**Step 3** 验证磁盘状态：
```bash
ls -la ~/.deepagents/workspaces/*/sessions/<sid>/
# 应该看到 metadata.json / messages.jsonl / harness-lifecycle.json
cat ~/.deepagents/workspaces/*/sessions/<sid>/metadata.json
cat ~/.deepagents/workspaces/*/sessions/<sid>/messages.jsonl
```

**Step 4** 重启 Zed agent，发送 "List Sessions" slash command（如果配置了）或直接通过 `runtime_info` 验证状态可读。

**预期**：
- session metadata 持久化（`status: "open"`）
- `messages.jsonl` 保留之前 user/assistant 消息
- `harness-lifecycle.json` 保留 counters 和 currentTurn 快照

**已知限制**：`deepagents-acp` v0.1.12 的 `replaySessionHistory` 在 reload 时会丢掉 `ToolMessage`（仅 re-emit `HumanMessage` + `AIMessage`）。所以 reload 后 agent 看得见历史对话但工具结果上下文是空的 — v0.2.0 不补这个（upstream bug，本地工作区有 plan 但还没实现）。

---

## 场景 7 — `.nuwax-agent` 资产可读性

**目的**：验证 `.nuwax-agent/` 下的 10 个配置文件对 agent 可见（不是只放在 repo 里）。

**提示词**：
```
列出 .nuwax-agent 目录下的所有 JSON 文件，告诉我每个文件的用途。
```

**预期**：agent 至少能说出 4 个文件及其作用：
- `lifecycle.json` — install / upgrade / uninstall 钩子
- `panel.config.json` — Nuwax panel 可管理的 config 字段白名单
- `sandbox-profiles.json` — 4 个 sandbox profile（open / workspace-write / read-only / custom）
- `capability-sources.json` — capability → 来源（ACP dynamic / agent builtin / env builtin / package placeholder / future durable state）
- `agent.spec.example.json` — `nuwax.agent.spec.v1` 的示例

**反向**（确认不在保护路径）：
```
把 packages/template/.nuwax-agent/agent.spec.example.json 改一下 description 字段。
```
预期：写成功（`.nuwax-agent/` 不在 `deniedPaths: ["src/runtime/"]` 内）。

---

## 场景 8 — HITL 权限弹窗（ask 模式 + edit_file）

**目的**：验证 `interruptOn` 机制在 `permissions.mode: "ask"` 下能弹权限弹窗。

**重要：本模板有两套独立的 mode 系统 — 不要混淆。**

| 系统 | 配置位置 | 控制 | Zed 暴露 |
|---|---|---|---|
| ACP mode（slash command 切）| `app-agent.config.json` `modes.availableModes` | Zed UI 的 plan/agent/ask 标签，UX / 提示词风格 | ✅ 是 |
| Deepagents 权限 mode（影响 HITL）| `app-agent.config.json` `permissions.mode` | `interruptOn` 是否触发，文件能否被写 | ❌ 否 |

**v0.2.0 默认**：`permissions.mode = "ask"`（在 `app-agent.config.json:27`），所以开箱就有权限弹窗。Zed UI 切 ACP mode 不影响 deepagents 权限 mode — 它们是正交的两条线。

**想覆盖默认**：在 `~/.config/zed/settings.json` 加：
```json
"env": {
  "DEEPAGENTS_PERMISSIONS_MODE": "yolo"   // 或 "plan"
}
```
然后 reload agent。

**v0.2.0+ 也支持 slash command 切换（不需重启）**：
```
/permissions ask
/permissions plan
/permissions yolo
/permissions             # 无参 — 显示当前 env + 用法
/pmode yolo              # 别名
/perm ask                # 短别名
```
**重要**：`/permissions` 设置 `DEEPAGENTS_PERMISSIONS_MODE` env var，但**当前 session 的 mode 仍为启动时的 baked-in 值**。要应用新 mode：
1. 在 Zed 里 disconnect 当前 session
2. 新建一个 session（自动读最新 env var）
3. 重新发 prompt 验证弹窗

这是诚实的设计 — 真正的「in-session mode flip」需要重建 LangGraph agent（v0.2.0 范围外）。如果你的部署需要频繁切 mode，建议部署多个 agent server 实例（每个 instance 自己的 `DEEPAGENTS_PERMISSIONS_MODE` env）。

**测试 client 切到 "reject" 选项**（参照 `tests/acp-verify.ts:71-73` 的默认行为）。

**提示词**：
```
把 examples/thesis-ppt/src/ppt-builder.ts 里 "微软雅黑" 全部改成 "PingFang SC"。
```

**Zed 中观察**：
- agent 发出 `requestPermission` 弹窗
- 默认选项 "reject" — agent_message_chunk 输出 "I can't do this"
- 切到 "allow-once" — `edit_file` 工具调用，文件实际修改

**如果没看到弹窗**：检查 `app-agent.config.json:27` 是否是 `"ask"`、Zed 进程是否 reload 过（v0.2.0 之前的早期配置是 `"yolo"`，需要改回来）。或者 `DEEPAGENTS_PERMISSIONS_MODE` env var 是否设了 `yolo`/`plan`。

---

## 诊断速查

| 现象 | 看哪里 |
|---|---|
| 工具被拒 | `cat ~/.deepagents/workspaces/*/sessions/*/harness-lifecycle.json \| jq .lastError` |
| 模型崩 | `LOG_DIR` 下的 stderr 日志（grep `level.*error` 或 `RequestError`） |
| 计数不对 | `harness-lifecycle.json` 的 `counters.*`（v0.2.0 修复后 middleware 是唯一来源 — 不应再 2x） |
| 路径错 | `protected-paths.ts` 的 `deniedGlobs`（runtime 不会暴露；查 `buildAgentConfigParts` 行为） |
| Agent 没出现在 Zed 列表 | `cat ~/.config/zed/settings.json` 确认 `args` 路径在 + 重启 Zed |
| 版本号仍是 0.1.1 | 验证 `packages/template/config/app-agent.config.json:6` 和 `package.json` 一致；后者是 fallback 来源 |
| OpenAI 兼容崩 | 检查 `@langchain/openai` 版本 >= 1.3.0（v0.2.0 修复了 0.5.x 的 duplicate @langchain/core 问题） |
| Compaction 没触发 | `config.middleware.compaction.contextWindow * triggerThreshold` 必须被消息 token 数超过；用 `runtime_info` 看 `currentTurn.endedAt` 之类的 hint 不准（compaction 是 middleware 行为，harness lifecycle 不直接观测） |
| **直接文件编辑绕过保护区** | `protected-paths` middleware 只守 **agent 工具调用**（`write_file`/`edit_file`），不守直接 `sed`/`Edit`/`vim`/linter 的人类编辑。TC-16 验证的是「agent 拒绝」，不是「文件绝对不可变」。要 OS-level 保护（`chmod -w`/git hooks）请自行加。 |

## 自动化烟测命令

如果想跑一遍非交互式 baseline（不在 Zed 里），用项目自带的脚本：

```bash
# Anthropic 兼容端点（默认）
npx tsx tests/acp-verify.ts

# OpenAI 兼容端点
LLM_PROVIDER=openai npx tsx tests/acp-verify.ts
```

期望：18/18 通过（包含 TC-01~TC-06 工具调用、TC-12 多轮上下文、TC-13 取消、TC-14 stale session、TC-15/TC-15b 多次写入、TC-16 受保护路径拒绝）。

## 反馈循环

发现新功能或回归时：
1. 查 `agent-core-progress.md` 的 "Status Legend" — 它用 `Supported` / `Planned` / `Blocked` / `Deferred` 四态追踪每项能力
2. 写一条复现步骤进 `docs/agent-core-progress.md` 的 "Next Step" 列
3. 如果是 bug，在 v0.2.0 之后的 plan 里加 fix

---

## 关联文档

- `zed-acp-setup.md` — Zed ACP server 配置
- `acp-test-plan.md` — 完整的 18 个测试用例设计（自动化）
- `agent-core-progress.md` — 能力完成度看板
- `scenario-agent-examples.md` — Scenario Agent 的 4 个示例 prompt
- `scenario-agent-template-design.md` — Scenario Agent 的设计原理
- `package-install-lifecycle.md` — 打包安装生命周期（与本验证流程互补）
- `template-capabilities.md` — 模板当前能力清单
