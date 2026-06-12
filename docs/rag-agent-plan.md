# RAG Agent 开发计划

> **⚠️ 已过时（2026-06-12）**：本文件是 RAG 内置于 `deepagents-app-ts` 的早期计划，与现状不符。
> 现状：RAG 已抽为 `deepagents-flow-ts` 的通用 flow 模板范例（`examples/rag/`），`app-ts` 还原为
> 纯 coding-agent，默认 flow 是占位骨架。当前架构见
> [`packages/deepagents-flow-ts/README.md`](../packages/deepagents-flow-ts/README.md)。
> 本文件保留作历史参考。

基于 `deepagents-app-ts` 模板实现一个 RAG（检索增强生成）Agent，验证模板的 LangGraph 节点能力。

## 流程架构

```
Query → Rewrite → Retrieve → Prepare → Agent → Response
```

```
┌─────────────────────────────────────────────────────────────────┐
│                        RAG Agent Flow                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Query   │───▶│ Rewrite  │───▶│ Retrieve │───▶│ Prepare  │  │
│  │ 用户输入  │    │ 意图识别  │    │ MCP检索   │    │ 结果整理  │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│                                                      │          │
│                                                      ▼          │
│                                                 ┌──────────┐    │
│                                                 │  Agent   │    │
│                                                 │ 推理生成   │    │
│                                                 └──────────┘    │
│                                                      │          │
│                                                      ▼          │
│                                                 ┌──────────┐    │
│                                                 │ Response │    │
│                                                 │ 返回结果   │    │
│                                                 └──────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## 决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 数据源 | 混合模式 | MCP 工具灵活接入不同数据源 |
| MCP 工具 | 向量数据库 | 语义检索为主 |
| Rewrite | LLM 重写 | 保持模型调用简洁 |
| 多工具调度 | LLM 决策 | Agent 根据意图自主选择工具 |
| Prepare | 全部（合并+压缩+格式化） | 统一输出供 Agent 使用 |
| Agent 执行 | 单次推理 + 流式输出 | RAG 场景通常单次，流式提升体验 |
| 多轮对话 | 支持 | 用户经常追问澄清 |
| 实现方式 | LangGraph StateGraph | 流程可视化、可调试、可扩展 |
| 代码位置 | `src/app/nodes/` | app 区域 AI 可编辑 |
| Rewrite 模型 | 复用主模型 | 简化配置 |
| 工具注册 | config 配置 | 与模板 MCP 机制一致 |
| 失败策略 | 节点级策略 | 每个节点独立处理失败 |
| 测试 | 单元 + 集成 + ACP smoke | 全面覆盖 |

## 状态结构

```typescript
interface RAGState {
  // 输入
  query: string;              // 用户原始问题
  
  // Rewrite 输出
  rewritten_query?: string;   // 重写后的查询
  intent?: string;            // 意图类型
  keywords?: string[];        // 关键词
  mcp_hint?: string;          // 建议工具
  
  // Retrieve 输出
  raw_results?: any[];        // MCP 工具原始返回
  
  // Prepare 输出
  context?: string;           // 标准化上下文
  sources?: Source[];         // 来源列表
  token_count?: number;       // token 数
  
  // Agent 输出
  answer?: string;            // 最终回答
  
  // 元数据
  history?: Message[];        // 对话历史
  metadata?: Record<string, any>;
}

interface Source {
  title: string;
  url?: string;
  snippet: string;
}

interface RAGResponse {
  answer: string;
  sources: Source[];
  confidence?: number;
  metadata: {
    intent: string;
    tools_used: string[];
    token_count: number;
    duration_ms: number;
  };
}
```

## 节点设计

### 1. Query（入口）
- 接收用户输入
- 加载对话历史
- 初始化 RAGState

### 2. Rewrite（意图识别 + 查询重写）
- 输入：`query` + `history`
- 输出：`rewritten_query`, `intent`, `keywords`, `mcp_hint`
- Prompt：分析用户意图，重写查询使其更适合检索
- 失败策略：**降级** — 用原始 query 继续

**意图类型：**
```
- factual: 事实查询
- how_to: 操作指南
- comparison: 对比分析
- latest: 最新信息
- explain: 概念解释
```

### 3. Retrieve（MCP 工具检索）
- 输入：`rewritten_query`, `intent`, `mcp_hint`
- 输出：`raw_results[]`
- 根据意图 + mcp_hint，LLM 决策调用哪些 MCP 工具
- 可并行调用多个工具
- 失败策略：**重试 1 次**，仍失败返回空结果

### 4. Prepare（结果准备）
- 输入：`raw_results[]`
- 输出：`context`, `sources`, `token_count`
- 合并多个工具返回的结果
- 去重 + 按相关性排序
- 截断/摘要过长内容（控制 token）
- 格式标准化
- 失败策略：**不会失败**（空输入也处理）

### 5. Agent（推理生成）
- 输入：`context`, `rewritten_query`, `history`
- 输出：`answer`
- 基于上下文生成最终回答
- 流式输出
- 失败策略：**中断返回错误**

### 6. Response（出口）
- 组装 RAGResponse
- 包含来源引用
- 记录元数据（耗时、token、工具使用）

## 配置结构

```json
{
  "rag": {
    "enabled": true,
    "retrievalTools": ["chromadb-search", "brave-search"],
    "rewrite": {
      "maxKeywords": 5,
      "intentCategories": ["factual", "how_to", "comparison", "latest", "explain"]
    },
    "retrieve": {
      "maxResults": 10,
      "timeout_ms": 5000,
      "retryCount": 1
    },
    "prepare": {
      "maxContextTokens": 4000,
      "deduplication": true,
      "sortByRelevance": true
    },
    "agent": {
      "streaming": true,
      "includeSources": true,
      "confidenceThreshold": 0.5
    }
  }
}
```

## 文件结构

```
packages/deepagents-app-ts/
├── src/
│   ├── app/
│   │   ├── nodes/                    # 新增：RAG 节点
│   │   │   ├── rewrite.ts            # 意图识别 + 查询重写
│   │   │   ├── retrieve.ts           # MCP 工具调度
│   │   │   ├── prepare.ts            # 结果合并/压缩/标准化
│   │   │   ├── agent.ts              # 最终推理生成
│   │   │   └── index.ts              # 节点导出
│   │   ├── graph.ts                  # 新增：RAG StateGraph 定义
│   │   ├── tools/                    # 现有 tools
│   │   └── hooks/                    # 现有 hooks
│   └── runtime/
│       └── config/
│           └── config-schema.ts      # 修改：添加 rag 配置 schema
├── config/
│   └── rag-agent.config.json         # 新增：RAG 配置示例
├── prompts/
│   └── rag-rewrite.system.md         # 新增：Rewrite 节点 prompt
├── tests/
│   ├── unit/
│   │   └── nodes/                    # 新增：节点单元测试
│   │       ├── rewrite.test.ts
│   │       ├── retrieve.test.ts
│   │       ├── prepare.test.ts
│   │       └── agent.test.ts
│   └── integration/                  # 新增：集成测试
│       └── rag-flow.test.ts
└── docs/
    └── rag-agent.md                  # 新增：RAG Agent 文档
```

## 实施步骤

### Phase 1：基础设施
1. 从 main 拉 worktree 分支 `feat/rag-agent`
2. 添加 RAG 配置到 config schema
3. 创建 `src/app/nodes/` 目录结构

### Phase 2：节点实现
4. 实现 Rewrite 节点（意图识别 + 查询重写）
5. 实现 Retrieve 节点（MCP 工具调度）
6. 实现 Prepare 节点（结果处理）
7. 实现 Agent 节点（推理生成）

### Phase 3：Graph 编排
8. 创建 RAG StateGraph 定义
9. 连接节点，定义边和条件路由
10. 集成到 ACP server

### Phase 4：测试验证
11. 编写单元测试（每个节点）
12. 编写集成测试（端到端流程）
13. ACP smoke test

### Phase 5：文档完善
14. 编写 RAG Agent 使用文档
15. 添加配置示例

## 验证标准

- [ ] Rewrite 能正确识别意图并重写查询
- [ ] Retrieve 能根据意图调用正确的 MCP 工具
- [ ] Prepare 能合并、去重、压缩结果
- [ ] Agent 能基于上下文生成有来源引用的回答
- [ ] 流式输出正常工作
- [ ] 多轮对话上下文保持
- [ ] 各节点失败时按策略降级
- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试端到端通过
- [ ] ACP smoke test 通过

## 开发命令

```bash
# 创建 worktree
git worktree add ../deepagents-dev-templates-rag -b feat/rag-agent main

# 进入 worktree
cd ../deepagents-dev-templates-rag/packages/deepagents-app-ts

# 开发
pnpm dev

# 测试
pnpm test
```
