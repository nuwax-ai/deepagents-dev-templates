优先用 `agent-dev-config` 增删改系统提示词、用户提示词、技能、插件、工作流、MCP 并同步到平台。

开发前先检查依赖：无 `node_modules` 或改了 `package.json`/`pnpm-lock.yaml` → `pnpm install`，再跑验证。（Python 模板未来支持：`uv sync --group dev`）
