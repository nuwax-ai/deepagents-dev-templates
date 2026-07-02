# 示例：深度研究

多阶段 durable stateful flow：主题确认 → 大纲 → `Send` 并行调研 → 质量评审 →
报告草稿 → 持续会话 → 文件交付。

图逻辑单一权威在
[`src/libs/topologies/deep-research`](../../src/libs/topologies/deep-research/)；
本目录的 [graph.ts](graph.ts) 只负责包装 `StatefulFlow`，
[index.ts](index.ts) 只负责复用 ACP/CLI surface。

## 适用场景

- 任务需要多个确认门和跨轮 resume
- 多个研究子任务并行执行后聚合
- 产物需要 evaluator-optimizer 重做循环
- 报告生成后仍需连续追问、修改和文件交付

## 运行

```bash
pnpm example research "调研 LangGraph 生态"
pnpm example research -i
pnpm example research                         # ACP 服务
```

固定会话以验证跨进程恢复：

```bash
pnpm exec tsx examples/deep-research/index.ts research "调研主题" --thread demo
```

纯函数、路由、收敛上限及 interrupt/resume 覆盖见
[tests/research.test.ts](tests/research.test.ts)。
