优先用 `agent-dev-config` 增删改系统提示词、用户提示词、技能、插件、工作流、MCP 并同步到平台。

**必须先装依赖**：处理用户请求前，若依赖未就绪必须先安装，禁止跳过、禁止先干别的。有 `package.json` → 无 `node_modules` 或 lock 变更则 `pnpm install`；有 `pyproject.toml` → 无 `.venv` 或 lock 变更则 `uv sync --group dev`。就绪后再继续。
