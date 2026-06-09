---
name: acp-smoke-test
description: "开发阶段用 rcoder-cli 在本地启动 ACP Agent 并发送消息，快速验证改动是否可运行"
tags: [rcoder, acp, env, dev, smoke-test]
version: "1.0.0"
---

# 开发阶段 ACP 运行测试

## When to Use

开发过程中，每次想快速确认 agent 能否正常启动和响应时使用。  
`rcoder-cli` 是真实 rcoder 云端 agent runtime 的终端版本，本地直接用，和云端运行路径一致。

典型场景：
- 新增或修改了工具/技能，想立刻测一下效果
- 修改了 `.env` 或配置后，确认 agent 还能正常启动
- 开发完一个功能，想交互式验证对话是否符合预期

## 前提

```bash
npm install -g rcoder-cli   # 仅需安装一次
rcoder-cli --version        # 确认安装成功
```

## 快速冒烟（最常用）

```bash
rcoder-cli chat \
  -c "node dist/bundle.mjs" \
  -w . \
  -p "hello" \
  --timeout 30 \
  --mode yolo \
  -q
```

或直接：

```bash
npm run smoke:acp
```

agent 有响应、exit 0 即说明本次改动没有破坏启动流程。

## 交互式对话调试

想多轮对话验证某个功能时：

```bash
rcoder-cli tui -c "node dist/bundle.mjs" -w .
```

进入全屏 TUI，直接和 agent 对话，和生产环境 rcoder 体验一致。

## 常见失败原因

| 错误 | 原因 | 修复 |
|------|------|------|
| `model_provider is None` / unresolved placeholders | `.env` 缺少 API Key | 填写 `ANTHROPIC_API_KEY` 或 `OPENAI_API_KEY` |
| `Failed to start subprocess` | agent 启动崩溃 | 先跑 `node dist/bundle.mjs` 看原始报错 |
| timeout | ACP 握手无响应 | 加 `-vv` 看详细日志 |

加 `-vv` 看详细日志：

```bash
rcoder-cli chat -c "node dist/bundle.mjs" -w . -p "hello" -vv
```
