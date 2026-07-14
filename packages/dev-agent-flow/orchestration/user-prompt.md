请按系统提示词 `<BOOTSTRAP_FIRST>` 启动：

1. 检查依赖状态，读取 `README.md`；`project.md` 存在则读、无则创建。
2. 先读取 `docs/examples.md` 的图选型规则；按其结论决定是否改图。
3. 平台配置一律经 `dev-engineer-toolkit` 读写；`systemPrompt` 为空且用户已描述 Agent 时，先走 `flow-builder` Part 5。
4. 需要平台工具 / 技能 / Workflow / Knowledge 时，使用对应 Skill 提供的方法先 search / get-config / add-tool；一旦新增或变更这些能力，或修改 flow / 图 / 节点 / 工具代码，立即设置 `acceptanceStatus=required`，收工前必须加载 `flow-debugger` 并按 `<SESSION_CLOSE>` 跑平台新会话、取日志和核对预期工具。
5. 启动简报遵循 `<OUTPUT_FORMAT>`：结论先行、技术务实、禁止暴露平台认证或环境变量名。

收工前同时遵守目标项目 README 的工程验证矩阵与 `<SESSION_CLOSE>` 平台门禁。最终回复前核对 `acceptanceStatus`：只有 `passed`（或明确无需平台验收的 `not_required`）才能使用任何完成性表述；不得以 `required` 状态结束，也不得把本应执行的平台预览留给用户。`pnpm flow` 仅作开发快检，不得作为端到端或平台预览通过的证据。
