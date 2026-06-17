# deepagents-flow-ts — AI Agent 项目说明

> 本文档面向 **在本仓库内工作的 AI Agent**。这就是用户的完整工作区：解压即用、单仓库、单 `package.json`。
> 所有路径与命令均以**本仓库根目录**为基准；不要臆造仓库外的目录、兄弟项目或其它工作区结构。

## 你是谁、要做什么

用户用本模板搭建 **LangGraph 工作流 Agent**（显式节点图 + 条件边 / `interrupt` / `Send`），**不是**自由 tool loop。

你的职责：
1. 在 **`src/app/`** 改默认图（`graph.ts` 连线 + `nodes/` 节点实现 + `tools/` 工具）
2. 新建 flow 时，**先读 `examples/` 中最接近的范例**学拓扑与挂接方式，然后在 **`src/app/`** 实现（改 `graph.ts` 连线、`nodes/` 节点、`tools/` 工具）
3. **不要改** `src/core/`、`src/runtime/`、`src/surfaces/`、`src/compose/`（契约 / 底层运行时 / 适配器 / 组合根；除非用户明确要求）
4. 需要新底层能力时，在 **`src/runtime/`** 内扩展或拷贝实现，并改 import 指向本项目文件

## 项目结构

```
src/
  core/          # 契约层（纯类型）：FlowCallbacks/FlowExecutor/StatefulFlow/事件——app 与 surfaces 共享
  runtime/       # 底层运行时（自包含、保护）—— 按职责聚合成子模块
    index.ts     #   barrel（公开 API）；flow-config.ts=配置加载；flow-runtime.ts=FlowRuntime 接口；logger/version
    config/      #   配置 schema + 三层加载
    platform/    #   平台 client + 变量管理
    context/     #   运行时上下文装配 + 发现 + 模型/提示词解析
    fs/          #   文件 / 搜索 / 沙箱（工具支撑）
    services/    #   checkpoint / LLM 韧性 / MCP stdio
  app/           # 默认 ReAct 图（可改）
    graph.ts     #   只做「建节点 + 连边」（图是契约）
    nodes/       #   节点实现：prepare / think / tools / respond
    tools/       #   全部内置工具：bash/fs/search/demo/mcp-bridge + http/json/platform_api/agent_variable（在此加新工具）
  surfaces/      # ACP / CLI 适配器（保护）
  compose/       # 组合根：createFlowRuntime 装配 runtime + tools（保护）
  index.ts       # 入口 / 装配
examples/        # ★ 新 flow 优先对照的参考实现
config/          # flow-agent.config.json、mcp.*.json
prompts/         # flow.base.md
skills/          # SKILL.md
scripts/         # 打包、smoke（.mjs）
docs/            # flow-patterns、capabilities、zed-debug
tests/           # 默认图单测 + 分层守卫（layering.test.ts）
```

### 分层 import 方向（**只能 import 左侧的层**）

```
core → runtime → app → { surfaces | compose } → index.ts
(纯契约) (底层运行时) (默认图)   (适配器 | 组合根)      (入口/装配)
```

`surfaces` 与 `compose` 平级，互不引用；跨层向下装配只许出现在 `compose/` 和 `index.ts`。
这条规则由 [tests/layering.test.ts](tests/layering.test.ts) **强制**——违规（如 `app/` import `surfaces/`）会让测试变红。加节点 / 加工具时照此放层即可。

### 底层运行时（`src/runtime/`，自有、自包含）

配置加载、模型解析、日志、MCP、平台 API 等底层能力都在 [src/runtime/](src/runtime/)，模板**自包含、无外部 runtime 依赖**。统一从 barrel 引入：

```ts
import { loadConfig, resolveModel, logger, createRuntimeContextAsync /* … */ } from "../runtime/index.js";
```

常见导出：`loadConfig`、`AppConfig`、`AppConfigSchema`、`resolveModel`、`logger`、`createRuntimeContextAsync`、`resolveSystemPrompt`、`resolveSkillsPaths`、`discoverSubAgents`、`RuntimeContext`、`ACPSessionConfig`
（MCP 用 `@langchain/mcp-adapters`，由 runtime-context 内部自管，不单独导出 manager）。

装配成 flow：`FlowRuntime` 接口在 [src/runtime/flow-runtime.ts](src/runtime/flow-runtime.ts)、装配工厂
`createFlowRuntime` 在 [src/compose/flow-runtime.ts](src/compose/flow-runtime.ts)、flow 配置加载在 [src/runtime/flow-config.ts](src/runtime/flow-config.ts)。

> 需要新底层能力时，在 `src/runtime/` 内扩展，import 指向本项目路径 —— **只在当前仓库内解决**。

---

## examples/ — 参考库（纯只读）

> ⚠️ **`examples/` 是给 AI Agent 做开发时参考用的示例代码，纯只读。**
> 你**不应该**在 `examples/` 下创建新目录、修改已有范例、或把它当作开发工作区。
> 正确用法：**阅读**范例学拓扑与挂接方式 → 在 **`src/app/`** 中实现。
>
> 新 flow、改拓扑、加 HITL / 并行 / 重试时，**先来这里**读，不要从零猜 LangGraph 或改 `src/surfaces/`。

### AI Agent 工作流

1. **判需求** → 从下表选最接近示例
2. **读** `README.md` + `graph.ts`
3. **在 `src/app/` 实现** → 改 `graph.ts` 连线、`nodes/` 节点逻辑、`tools/` 工具
4. **补测试** → `tests/`

### 示例对照表

| 目录 | 场景 | 学什么 | Flow 类型 |
|------|------|--------|-----------|
| [examples/rag](examples/rag/) | 检索增强、条件重试 | 线性链 + 重试环、`FlowExecutor` | one-shot |
| [examples/travel-planner](examples/travel-planner/) | 并行调研聚合 | `Send` 扇出、reducer、HITL | stateful |
| [examples/project-manager](examples/project-manager/) | 分解→评估→审批 | reflection 回边、条件边 | stateful |
| [examples/human-in-loop](examples/human-in-loop/) | 生成→人审→定稿 | `interrupt` + `Command(resume)` | stateful |
| [examples/dev-agent](examples/dev-agent/) | 综合能力 | ReAct + subgraph、compact | stateful |
| [examples/deep-research](examples/deep-research/) | 长任务报告 | 多阶段流水线、跨重启、`onStage` | stateful |

有状态示例统一用 **`createStatefulFlow`**（[src/surfaces/stateful-flow.ts](src/surfaces/stateful-flow.ts)）。

### 开发位置

所有 flow 开发都在 **`src/app/`**：
- `graph.ts` — 连线与条件路由（图是契约）
- `nodes/` — 节点实现（prepare / think / tools / respond）
- `tools/` — 内置工具（在此加新工具）

`examples/` 下的代码**仅供参考**，不要在其中创建或修改任何内容。

### 默认 flow vs 示例

| | `src/app/` | `examples/*` |
|--|------------|--------------|
| 用途 | 开箱 ReAct + **开发工作区** | 只读参考拓扑 |
| 无凭证 | 有 fallback，可跑 | 真调 LLM，须 `.env` |
| 何时改 | 所有 flow 开发都在这里 | 不改——仅供阅读学习 |

---

## 架构规则

### 保护区 vs 业务区

| 区域 | 路径 | 规则 |
|------|------|------|
| 契约 | `src/core/` | 纯类型;改契约需同步 app + surfaces |
| 底层运行时 / 适配器 / 组合根 | `src/runtime/`、`src/surfaces/`、`src/compose/` | 默认不改 |
| 默认图 | `src/app/`（`graph.ts` 连线 + `nodes/` 节点 + `tools/` 工具） | 可改 |
| 参考（只读） | `examples/` | 阅读学拓扑，不修改不新建 |
| 开发工作区 | `src/app/` | graph.ts + nodes/ + tools/ |
| 配置 | `config/`、`prompts/`、`skills/`、`.agents/` | 按需扩展 |

### 设计原则

1. **图是契约** — 边与条件路由在 `graph.ts`，节点实现拆到 `nodes/`（默认图见 [src/app/nodes/](src/app/nodes/)）；决策逻辑抽纯函数 + 单测
2. **先 examples** — RAG / 并行 / HITL / 长任务，先打开对应范例
3. **Surface 与图解耦** — 图包成 executor，挂现有 bootstrap，不重写 ACP/CLI
4. **有状态用基座** — `createStatefulFlow`，不手写 run-loop
5. **提示词** — ACP / 面板下发为主；`prompts/flow.base.md` 为 fallback
6. **工具顺序** — MCP → 内置工具 → platform_api / agent_variable → 自写代码
7. **密钥** — 环境变量或 agent variable，禁止硬编码
8. **依赖只在本仓库** — 缺能力就 `pnpm install`、在 `src/runtime/` 扩展，或 copy-in；不引用仓库外路径

### 两类 Flow（`src/core/flow-types.ts`；旧路径 `src/surfaces/flow-types.ts` 为兼容 shim）

| 类型 | 场景 | 示例 |
|------|------|------|
| `FlowExecutor` | one-shot | `examples/rag` |
| `StatefulFlow` | HITL、跨重启 | travel / pm / review / deep-research / dev-agent |

## 技术栈

- LangGraph（`@langchain/langgraph`）
- ACP：`deepagents-acp`
- 配置 / 模型 / 平台：模板自有底层运行时（`src/runtime/`）；MCP：`@langchain/mcp-adapters`
- TypeScript（ESM、strict）
- 包管理：pnpm

## 配置与凭证

- [config/flow-agent.config.json](config/flow-agent.config.json)
- [.env.example](.env.example) → 复制为 `.env`
- [docs/capabilities.md](docs/capabilities.md)
- `OPENAI_*` 时设 `model.provider` 为 `"openai"`

## 构建与运行

```bash
pnpm install
pnpm build

pnpm flow "你好"
pnpm exec tsx src/index.ts flow -i
pnpm start:acp
pnpm graph
pnpm exec tsx src/index.ts capabilities
pnpm exec tsx src/index.ts sessions

pnpm example:rag:cli "什么是 LangGraph？"
pnpm example:travel "东京 3 天"
pnpm example:research "调研主题"
```

## 调试

| 命令 | 说明 |
|------|------|
| `pnpm smoke:acp` | 默认 flow ACP 冒烟 |
| `pnpm smoke:rag` 等 | `--entry examples/...` |
| `pnpm smoke:acp -- --debug --dry-run` | 仅打印命令 |

见 [docs/zed-debug.md](docs/zed-debug.md)。

## 测试

```bash
pnpm test
pnpm typecheck
pnpm typecheck:examples
RUN_INTEGRATION=1 pnpm test:integration
```

## 打包

```bash
pnpm bundle
pnpm package:platforms
pnpm check:tools
```

见 [scripts/README.md](scripts/README.md)。

## 扩展阅读

- 各 `examples/*/README.md`
- [docs/flow-patterns.md](docs/flow-patterns.md)
- [README.md](README.md)（用户向说明）
