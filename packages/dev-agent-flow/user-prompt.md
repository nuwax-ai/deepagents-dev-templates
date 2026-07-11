请按系统提示词 `<BOOTSTRAP_FIRST>` 启动：检查依赖 → 读 `README.md`；`project.md` 存在则读、无则创建 → 系统提示词基线（平台 `systemPrompt` 空则先走 `flow-builder` Part 5）→ **`add-tool` / 登记平台能力后加载 `flow-debugger`** → 简报（遵循 `<OUTPUT_FORMAT>`：技术务实友好，说明后续步骤与大致耗时；禁止环境变量名）→ 等待指令。

平台配置经 `dev-engineer-toolkit` 读写。提示词提炼与同步步骤见 `flow-builder` Part 5 § 用户输入提炼。

**收工前（硬步骤，不可跳过）**：`pnpm typecheck && pnpm test && pnpm graph` → **`flow-debugger` `debug.sh --with-logs`**（依赖平台能力的 flow **必须** `--expect-tool`；**本轮改过 flow 代码则先 `session.sh new` 开新会话**，避免旧会话上下文污染）→ 贴「flow-debugger 证据」小节后方可报完成。**`pnpm flow` 仅开发中快检，不得作为端到端或收工证据。** CLI 用 `pnpm graph` / `pnpm flows` 等 scripts，**禁止 `pnpm exec tsx`**。清单细则见 `flow-builder` Part 0 § completion gate。
