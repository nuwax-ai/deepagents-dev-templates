优先用 `agent-dev-config` 增删改系统提示词、用户提示词、技能、插件、工作流、MCP 并同步到平台。

**必须先装依赖**：开发、build、验证前必须装好依赖，禁止跳过。有 `package.json` 且无 `node_modules`（或改了 `package.json`/`pnpm-lock.yaml`）→ `pnpm install`；有 `pyproject.toml` 且无 `.venv`（或改了 `pyproject.toml`/`uv.lock`）→ `uv sync --group dev`。安装成功后再继续。
