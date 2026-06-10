---
name: deepagents-framework
description: "deepagents npm 包的核心 API 参考：createDeepAgent、FilesystemBackend、工具注册、配置结构和框架生命周期"
tags: [deepagents, framework, api, tools, config]
version: "1.0.0"
---

# deepagents 框架参考

## When to Use

需要使用或理解 `deepagents` npm 包 API 时使用——包括创建 agent、注册工具、配置框架参数、或理解 agent 的运行生命周期。

---

## 核心 API

### createDeepAgent(config)

`deepagents` 的主入口函数，接受 `DeepAgentConfig` 并返回一个可调用的 agent。

```typescript
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { MemorySaver } from "@langchain/langgraph-checkpoint";

const backend = new FilesystemBackend({ rootDir: process.cwd() });

const agent = createDeepAgent({
  model: "claude-sonnet-4-6",           // 模型名称（字符串）
  systemPrompt: "你是一个...",           // 系统提示词
  tools: [...myTools],                   // StructuredTool[]
  backend,                               // FilesystemBackend
  checkpointer: new MemorySaver(),       // 持久化 checkpointer（ACP 模式必需）
  permissions: [...],                    // 文件系统权限规则
  skills: ["./skills/builtin/", "./skills/platform/"], // 技能目录路径
  memory: ["./CLAUDE.md"],               // 内存/上下文文件路径
  middleware: [...],                     // 中间件数组
});
```

### FilesystemBackend

提供文件系统访问，rootDir 为 agent 的工作根目录。

```typescript
import { FilesystemBackend } from "deepagents";

const backend = new FilesystemBackend({ rootDir: workspaceRoot });
```

### createMemoryMiddleware

显式创建内存中间件，支持 Anthropic prompt caching：

```typescript
import { createMemoryMiddleware } from "deepagents";

const memMw = createMemoryMiddleware({
  backend,
  sources: ["./CLAUDE.md", "~/.deepagents/memory/"],
  addCacheControl: true, // 仅 anthropic provider 有效
});
```

---

## 模板工厂模式（createAppAgent）

模板中的工厂函数封装了上述步骤：

```typescript
// src/runtime/agent-factory.ts
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { buildAgentConfigParts } from "./agent-config.js";
import { createRuntimeContext } from "./runtime-context.js";

export function createAppAgent(config: AppConfig, sessionConfig?: ACPSessionConfig) {
  const workspaceRoot = resolveConfiguredWorkspaceRoot(config, sessionConfig?.cwd ?? process.cwd());
  const context = createRuntimeContext(config, sessionConfig, workspaceRoot);
  const backend = new FilesystemBackend({ rootDir: workspaceRoot });
  const agentConfig = buildAgentConfigParts(
    config, sessionConfig, workspaceRoot, context.tools, backend
  );
  const agent = createDeepAgent({ ...agentConfig, backend });
  return { agent, context, backend };
}
```

---

## 工具注册模式

### ToolContext 接口

```typescript
// src/app/tools/index.ts
export interface ToolContext {
  platformClient: PlatformClient | null; // null = local-only 模式
  mcpManager: MCPManager;
  variableManager: VariableManager;
  workspaceRoot: string;
}

export function createTools(ctx: ToolContext): StructuredTool[] {
  return [
    httpRequestTool,           // 无状态工具：直接引用
    jsonUtilsTool,
    createPlatformApiTool(ctx.platformClient),   // 平台绑定：工厂函数
    createAgentVariableTool(ctx.variableManager),
    createMcpBridgeTool(ctx.mcpManager),
  ];
}
```

### 无状态工具 vs 平台绑定工具

| 类型 | 场景 | 注册方式 |
|------|------|---------|
| 无状态 | 不需要平台 API / 运行时对象 | 直接 `import` + 加入数组 |
| 平台绑定 | 需要 PlatformClient / MCPManager / VariableManager | 工厂函数 `createXxxTool(ctx)` |

---

## 配置结构 AppConfig

```typescript
// 关键字段（config/app-agent.config.json 的类型）
interface AppConfig {
  agent: {
    name: string;
    description: string;
    systemPromptPath: string;   // 默认 "prompts/developer-agent.system.md"
    outputStyle: string;
  };
  model: {
    provider: "anthropic" | "openai";
    name: string;               // 如 "claude-sonnet-4-6"
    baseUrl?: string;           // OpenAI 兼容代理
    apiKeyEnv: string;          // 默认 "ANTHROPIC_API_KEY"
  };
  mcp: {
    configPath: string;         // 默认 "config/mcp.default.json"
    mergeStrategy: "session-wins" | "platform-wins" | "defaults-wins";
  };
  permissions: {
    mode: "yolo" | "ask" | "plan";
    allowedPaths: string[];     // AI 可写路径
    deniedPaths: string[];      // 保护路径
  };
  skills: {
    directories: string[];      // 技能目录列表
  };
}
```

**配置优先级链（从低到高）**：
```
defaults < user ~/.deepagents < project .deepagents < config file < env vars < ACP session
```

---

## 环境变量

| 变量 | 用途 |
|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 |
| `OPENAI_API_KEY` | OpenAI API 密钥 |
| `OPENAI_BASE_URL` | OpenAI 兼容代理 URL |
| `LLM_PROVIDER` | `anthropic` 或 `openai` |
| `ANTHROPIC_MODEL` / `OPENAI_MODEL` | 模型名覆盖 |
| `PLATFORM_API_TOKEN` | 平台 API 认证 token |
| `PLATFORM_AGENT_ID` | 平台 Agent ID |
| `PLATFORM_SPACE_ID` | 平台 Space ID |
| `DEEPAGENTS_WORKING_DIR` | 工作目录覆盖 |

---

## 验证命令

```bash
pnpm run build        # TypeScript 编译 → dist/
pnpm run typecheck    # tsc --noEmit
pnpm test             # vitest run（单元测试）
pnpm run graph        # 输出 nuwaclaw.agent-code-graph.v1 JSON
pnpm run test:acp-smoke  # ACP 协议兼容性检查（不调用 LLM）
```

## Anti-patterns

- ❌ 在 `src/runtime/` 中修改框架代码（只能在 `src/app/` 添加工具）
- ❌ 直接调用 `createDeepAgent()` 而不用 `buildAgentConfigParts`（会丢失中间件链）
- ❌ 在工具代码中硬编码 API key（使用 `VariableManager` 或 `process.env.AGENT_VAR_XXX`）
- ❌ 在运行时代码中硬编码系统提示词（提示词从 ACP session 或文件加载）
- ✅ 新工具放在 `src/app/tools/`，注册到 `createTools()`
- ✅ 用 `ToolContext` 工厂函数访问运行时资源
- ✅ 编译和 graph 命令通过后再报告完成