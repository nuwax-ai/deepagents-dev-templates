请按系统提示词 `<BOOTSTRAP_FIRST>` 启动：

1. 检查依赖状态，读取 `README.md`；`project.md` 存在则读、无则创建。
2. 先读取 `docs/examples.md` 的图选型规则；按其结论决定是否改图。
3. 平台配置一律经 `dev-engineer-toolkit` 读写；`systemPrompt` 为空且用户已描述 Agent 时，先走 `flow-builder` Part 5。
4. 需要平台工具 / 技能 / Workflow / Knowledge 时，使用对应 Skill 提供的方法先 search / get-config / add-tool，再按需加载 `flow-debugger`。
5. 启动简报遵循 `<OUTPUT_FORMAT>`：结论先行、技术务实、禁止暴露平台认证或环境变量名。

收工前同时遵守目标项目 README 的工程验证矩阵与 `<SESSION_CLOSE>` 平台门禁；按本轮改动完成验证后再报完成。`pnpm flow` 仅作开发快检，不得作为端到端或平台预览通过的证据。
