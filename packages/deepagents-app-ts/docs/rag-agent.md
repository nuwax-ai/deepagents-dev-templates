# RAG Agent

基于 `deepagents-app-ts` 模板实现的 RAG（检索增强生成）Agent。

## 流程架构

```
Query → Rewrite → Retrieve → Prepare → Agent → Response
```

| 节点 | 职责 |
|------|------|
| Query | 接收用户输入，初始化状态 |
| Rewrite | 意图识别 + 查询重写 |
| Retrieve | 调用 MCP 工具检索 |
| Prepare | 结果合并/去重/压缩 |
| Agent | 基于上下文推理生成回答 |
| Response | 组装最终响应 |

## 快速开始

```typescript
import { executeRAG } from "./src/app/graph.js";

// 执行 RAG 查询
const response = await executeRAG("什么是机器学习？", {
  config: {
    retrievalTools: ["chromadb", "brave-search"],
    // ... 其他配置
  },
});

console.log(response.answer);
console.log(response.sources);
```

## 配置

在 `config/rag-agent.config.json` 中配置：

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

## 意图类型

| 意图 | 说明 | 推荐工具 |
|------|------|----------|
| `factual` | 事实查询 | 向量数据库 |
| `how_to` | 操作指南 | 知识库 + 搜索 |
| `comparison` | 对比分析 | 多源检索 |
| `latest` | 最新信息 | 搜索引擎 |
| `explain` | 概念解释 | 知识库 |

## 状态结构

```typescript
interface RAGState {
  query: string;              // 用户输入
  rewritten_query?: string;   // 重写后的查询
  intent?: string;            // 意图
  keywords?: string[];        // 关键词
  context?: string;           // 标准化上下文
  sources?: Source[];         // 来源
  answer?: string;            // 最终回答
  metadata?: RAGMetadata;     // 元数据
}
```

## 节点实现

### Rewrite 节点
- 使用 LLM 分析用户意图
- 重写查询使其更适合检索
- 提取关键词和推荐工具

### Retrieve 节点
- 根据意图选择 MCP 工具
- 并行调用多个工具
- 收集原始结果

### Prepare 节点
- 合并多个工具结果
- 去重 + 排序
- 截断到 token 限制
- 提取来源引用

### Agent 节点
- 基于上下文生成回答
- 支持流式输出
- 包含来源引用

## 测试

```bash
# 运行节点单元测试
pnpm vitest run tests/unit/nodes/

# 运行集成测试
pnpm vitest run tests/integration/rag-flow.test.ts
```

## 扩展

### 添加新的 MCP 工具

1. 在 `config/rag-agent.config.json` 的 `retrievalTools` 中添加工具名
2. 在 Retrieve 节点的 `callMCPTool` 函数中实现工具调用逻辑

### 自定义意图

1. 在 `config/rag-agent.config.json` 的 `intentCategories` 中添加新意图
2. 在 Rewrite 节点的 prompt 中添加意图说明
3. 在 Retrieve 节点的 `intentToolMap` 中配置工具映射

## 文件结构

```
src/app/
├── graph.ts              # StateGraph 定义
├── nodes/
│   ├── types.ts          # 类型定义
│   ├── rewrite.ts        # 意图识别 + 查询重写
│   ├── retrieve.ts       # MCP 工具调度
│   ├── prepare.ts        # 结果处理
│   ├── agent.ts          # 推理生成
│   └── index.ts          # 导出
└── tools/                # 现有 tools
```
