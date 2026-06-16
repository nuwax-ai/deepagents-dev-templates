---
name: flow-prompt-designer
description: "基于 flow.base.md 设计 flow-ts 场景提示词并通过 save_prompt 保存"
tags: [prompts, design, acp, platform, flow]
version: "1.0.0"
---

# 提示词设计器（Flow 版）

## When to Use
需要为 flow-ts 工作流 Agent 设计或修改系统提示词时。

## 核心原则
- **提示词只从 ACP 会话获取**，禁止在运行时代码中硬编码
- **修改后必须通过 `platform_api(operation: "save_prompt")` 保存到平台**
- flow-ts 的提示词基准是 `prompts/flow.base.md`

## 设计步骤

### Step 1: 了解场景需求
与开发者确认：
 工作流要解决什么问题？
 走什么拓扑（ReAct / 条件路由 / 并行 / HITL / 多阶段）？
 think 节点的角色定位（决策者 / 路由器 / 执行者）？
 输入输出格式是什么？

### Step 2: 基于 flow.base.md 生成
`prompts/flow.base.md` 是 flow-ts 的基准提示词，结构：
```markdown
# Flow 工作流编排 Agent
你是基于显式 LangGraph 工作流图的 Agent（prepare -> think <-> tools -> respond）。

## 工作方式
1. prepare：加载并按需压缩会话历史
2. think：你是这一步，用 bindTools 决定调工具还是回答
3. tools：框架自动执行你选定的工具
4. respond：信息足够时给出最终回答

## 工具优先级（强制）
1. MCP 工具 -> 2. 内置工具 -> 3. 平台工具 -> 4. 自写代码
```

以它为基础，替换为具体场景：
```markdown
# [场景名] 工作流 Agent

你是一位 **[角色描述]**，按 **[拓扑描述]** 工作流处理 **[领域/场景]**。

## 工作方式
1. [节点1职责]
2. [节点2职责]
...

## 工具使用
### MCP 工具（先查有没有现成的）
[列出平台配置的 MCP 工具]
### 内置工具
- bash（命令执行）、文件读写、search、http_request、json_utils
### 平台工具
- platform_api、agent_variable、mcp_tool_bridge

## 行为准则
- 简洁直接，先行动后解释
- 工具调用失败时读错误信息、调整参数，不原地打转
- 写文件/执行命令遵守 permissions（默认 ask 需人审）
```

### Step 3: 保存提示词
```json
platform_api(operation: "save_prompt", params: {
  "prompt": "<生成的提示词内容>",
  "metadata": { "version": "1.0.0", "scenario": "<场景>" }
})
```

### Step 4: 验证
1. 检查提示词覆盖了所有节点职责
2. 检查工具说明与实际注册的工具对应
3. 通过 ACP 会话发测试 prompt 验证效果

## 提示词设计原则
1. **角色明确** — 开头定义「你是谁」「你在图里哪一步」
2. **拓扑对应** — 工作方式描述与 graph.ts 的节点连线一致
3. **工具指引** — 说明什么场景用什么工具（flow-ts 工具优先级）
4. **行为约束** — 失败处理、权限遵守、密钥管理

## 提示词来源（优先级）
```
ACP session（最高）> config.agent.systemPromptPath（flow.base.md）> fallback
```
提示词经 FlowRuntime.systemPrompt 注入 think 节点（作为 SystemMessage）。

## Anti-patterns
- 在 src/ 代码中硬编码提示词
- 修改后不 save_prompt 保存
- 提示词列出过时的工具名
- 工作方式描述与实际图拓扑不符
- ✅ 基于 flow.base.md 生成
- ✅ 提示词中的工具名与 FlowRuntime.allTools 对应
- ✅ 每次修改后 save_prompt
