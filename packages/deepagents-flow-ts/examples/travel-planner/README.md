# 示例：旅行规划（travel planner）

把一个目标拆成多个方面**并行**处理、聚合，再让用户确认/调整——`deepagents-flow-ts` 能做的
又一类需求（对比 RAG 的线性检索、默认图的迭代循环、human-in-loop 的纯审）。

对应 LangGraph 官方：**Map-reduce（`Send` 动态扇出）** + **Human-in-the-loop**（`interrupt` / `Command`）。

## 图

```
START → gather → ⟨Send 并行⟩ research × 4（交通/住宿/景点/美食）
      → aggregate → confirm(interrupt 确认/调整) → finalize → END
```

| 节点 | 职责 | 看点 |
|---|---|---|
| `gather` | 解析目的地 + 天数 | 纯逻辑 |
| `fanoutToResearch` | 对每个 aspect 派一个 research（条件边返回 `Send[]`） | **map 扇出** |
| `research` | 对单个 aspect 发一次**真实 DuckDuckGo 搜索**（免 key MCP，并行实例），`runTool` 透出过程 | **并行 + 真实 MCP + onToolCall** |
| `aggregate` | 等所有并行完成后**真调 LLM**把 4 路搜索结果整理成按天行程（barrier） | **reduce（reducer channel）** |
| `confirm` | `interrupt` 暂停，请用户确认/调整 | **HITL** |
| `finalize` | 通过则定稿；否则**真调 LLM**按意见改写 | — |

> `findings` channel 用 **reducer** 聚合：并行节点写同一 channel 必须用 reducer，否则互相覆盖。
> 这是和顺序流（默认图 `observe` 手动 append）的关键区别。

## 它如何用模板的 seam

`createTravelFlow()` 返回一个 **`StatefulFlow`**（因为有 confirm 的 interrupt）：`run({query})`→interrupted、
`run({resume})`→done。`onToolCall` 经 `config.configurable` 透传给并行的 research 实例（callbacks 随调用
流动，不污染固定的图 / checkpointer）。surface（acp/cli）plumbing 完全复用。

## 运行

```bash
pnpm --filter deepagents-app-ts build

pnpm --filter deepagents-flow-ts exec tsx examples/travel-planner/index.ts plan "东京 3 天 美食优先"
pnpm --filter deepagents-flow-ts exec tsx examples/travel-planner/index.ts plan -i
pnpm --filter deepagents-flow-ts exec tsx examples/travel-planner/index.ts          # ACP 服务
```

CLI 跑到行程草案会**暂停等你**输入确认/调整意见（同一终端继续输入）。

> **真实接入（无 demo fallback）**：`research` 调免 key 的 `duckduckgo-mcp-server`（`npx -y` 自动拉起，**无需 API key**）
> 做网络搜索；`aggregate`/`finalize` 真调大模型——因此需在 `.env` 配模型凭证
> （`ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `OPENAI_API_KEY`，没配会直接报错而非降级）。
> DDG 限 1 请求/秒，`rateLimited` 把并行搜索串行化错峰（图仍并行）。换别的搜索 MCP 改 `graph.ts` 里的 `SEARCH_MCP` 即可。

## 测试

[tests/travel.test.ts](tests/travel.test.ts)：**纯函数**（`gather` 解析 / `fanout` 扇出，无凭证恒跑）守住 map-reduce 拓扑；
**真实接入**用例（`skipIf` 无凭证）跑真实 DDG 搜索 + LLM 整理 + interrupt→resume。
