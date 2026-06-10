---
name: acp-smoke-test-py
description: "Python 模板 ACP 冒烟测试：使用 rcoder-cli 在本地验证 Python agent 能否正常启动和响应"
tags: [rcoder, acp, python, smoke-test, uv]
version: "1.0.0"
---

# Python 模板 ACP 冒烟测试

## When to Use

开发 Python 模板过程中，每次想快速确认 agent 能否正常启动和响应时使用。

典型场景：
- 新增或修改了工具，想立刻测一下效果
- 修改了 `.env` 或配置后，确认 agent 还能正常启动
- 开发完一个功能，想交互式验证对话是否符合预期

## 前提

```bash
uv sync --group dev     # 安装依赖（含开发依赖）
# rcoder-cli 目前仅发布在 npm 上，需通过 pnpm dlx 或 npx 运行
pnpm dlx rcoder-cli --version   # 或 npx rcoder-cli --version
```

## 快速冒烟（最常用）

```bash
pnpm dlx rcoder-cli chat \
  -c "uv run deepagents-app-py" \
  -w . \
  -p "hello" \
  --timeout 30 \
  --mode yolo \
  -q
```

agent 有响应、exit 0 即说明本次改动没有破坏启动流程。

## 交互式对话调试

想多轮对话验证某个功能时：

```bash
pnpm dlx rcoder-cli tui -c "uv run deepagents-app-py" -w .
```

进入全屏 TUI，直接和 agent 对话。

## 常见失败原因

| 错误 | 原因 | 修复 |
|------|------|------|
| `model_provider is None` / unresolved placeholders | `.env` 缺少 API Key | 填写 `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY` |
| `Failed to start subprocess` | agent 启动崩溃 | 先跑 `uv run deepagents-app-py` 看原始报错 |
| `ModuleNotFoundError` | 依赖未安装 | 运行 `uv sync --group dev` |
| timeout | ACP 握手无响应 | 加 `-vv` 看详细日志 |

加 `-vv` 看详细日志：

```bash
pnpm dlx rcoder-cli chat -c "uv run deepagents-app-py" -w . -p "hello" -vv
```

## 与 TS 模板的对比

| TS 模板 | Python 模板 |
|---------|------------|
| `pnpm dlx rcoder-cli` | `pnpm dlx rcoder-cli`（rcoder-cli 仅在 npm） |
| `-c "node dist/bundle.mjs"` | `-c "uv run deepagents-app-py"` |
| 前提：`pnpm run build` | 前提：`uv sync --group dev` |
