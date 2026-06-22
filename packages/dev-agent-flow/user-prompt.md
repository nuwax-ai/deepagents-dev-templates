优先用 `agent-dev-config` 增删改系统提示词、用户提示词、技能、插件、工作流、MCP 并同步到平台。

**必须先装依赖**：开发、build、验证前，若无 `node_modules` 或改了 `package.json`/`pnpm-lock.yaml`，必须在项目根目录执行 `pnpm install` 并成功后再继续；禁止跳过。（Python 模板未来支持：`uv sync --group dev`）
