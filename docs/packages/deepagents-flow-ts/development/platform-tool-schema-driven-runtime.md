# 平台工具 schema-driven runtime 方案（v2）

## 状态

✅ 现行（替代 `platform-tool-binding-design.md` 中“运行时不读 `spec.tools`”的旧口径）

## 目标

建立单一、可追踪的平台工具装配链路：

- 开发期先做平台搜索与注册（`dev-engineer-toolkit`）
- 运行期只用 `spec.tools` 作为 schema 与元数据来源
- runtime 动态创建 LangGraph `StructuredTool` 并统一注入 `FlowRuntime.allTools`
- 同时覆盖 `platform-tool`、`tool-exec`、默认 ReAct `bindTools`

## 端到端流程

1. 平台搜索工具（`search-apis.sh` / `search-skills.sh`）
2. 平台注册工具（`add-tool.sh`），`get-config.sh --key tools` 验证已启用
3. 将 `targetType/targetId/toolNames/schema` 写入 flow `spec.tools`
4. scaffold 把 `spec.tools` 透传到 flow 导出的 `platformToolRefs`
5. `createFlowRuntime` 读取 `platformToolRefs`，展开为 `platformToolDescriptors`
6. runtime 通过 `schema -> zod` 构建 `StructuredTool`
7. 合并进 `allTools`（同名去重，schema-driven 工具优先）
8. 图节点按工具名消费：`platform-tool` / `tool-exec` / `think.bindTools`

## 运行时实现要点

- `spec.tools` 是平台工具 schema 的唯一来源，不再依赖运行时额外发现
- descriptor 粒度按 `toolName` 展开（一个 `toolName` 一条 descriptor）
- schema 到 zod 支持常见 JSON Schema 结构（object/array/enum/required）
- 工具执行走统一 execute 边界（`plugin/execute`）

## 代码落点

- runtime 新增：
  - `src/runtime/platform-tools/types.ts`
  - `src/runtime/platform-tools/descriptor.ts`
  - `src/runtime/platform-tools/schema-to-zod.ts`
  - `src/runtime/platform-tools/create-platform-structured-tool.ts`
- 装配：
  - `src/index.ts`（`createFlowRuntime`）
  - `src/runtime/flow-runtime.ts`
  - `src/app/flow-tools.ts`
- scaffold / flow metadata：
  - `scripts/scaffold/blueprints/custom.mjs`
  - `scripts/scaffold/generate.mjs`
  - `src/app/flows/index.ts`

## 节点消费语义

- `platform-tool`：节点主动调用单工具，`params.toolName` 必填
- `tool-exec`：执行 `tool_calls`，可用 `params.tools` 限定工具集合
- 默认 ReAct：自动 `bindTools(runtime.allTools)`，可直接使用 schema-driven 平台工具

## 约束

- 仍需先平台注册，再在 `spec.tools` 声明
- 禁止为已登记平台能力手写 fetch / 自定义 `tool()` 包装
- 禁止依赖运行时平台配置查询来补齐 schema

## 与旧方案差异

- 旧：`spec.tools` 仅开发期记录，运行时不读
- 新：`spec.tools` 直达 runtime，驱动 `StructuredTool` 动态创建
- 旧：平台工具主要依赖外部注入
- 新：以 flow 内 schema 声明为准，runtime 内可重复、可测试、可追踪
