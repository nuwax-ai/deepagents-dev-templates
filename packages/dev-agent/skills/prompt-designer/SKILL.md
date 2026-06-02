---
name: prompt-designer
description: "基于 target-agent.base.md 设计场景提示词并通过 save_prompt 保存"
tags: [prompts, design, acp, platform]
version: "1.0.0"
---

# 提示词设计器

## When to Use
需要为场景 Agent 设计或修改系统提示词时使用。

## 核心原则
- ⚠️ **提示词只从 ACP 会话获取**，禁止在运行时代码中硬编码
- ⚠️ **修改后必须通过 `platform_api(operation: "save_prompt")` 保存到平台**

## 设计步骤

### Step 1: 了解场景需求
与开发者确认：
- Agent 要解决什么问题？
- 目标用户是谁？
- 需要哪些核心能力？
- 输入输出格式是什么？

### Step 2: 基于模板生成
以 `prompts/target-agent.base.md` 为基础，替换占位符：

```markdown
# [Agent Name] — [Domain] Agent

你是一位 **[角色描述]**，专注于 **[领域/场景]**。

## 核心能力
- [能力 1]：具体描述
- [能力 2]：具体描述
- [能力 3]：具体描述

## 行为准则
- 简洁直接，先行动后解释
- 使用可用工具，不写不必要的代码
- 遇到歧义时主动提问

## 工具使用
### 平台工具（MCP）
[列出平台配置的 MCP 工具]

### 内置工具
- 文件操作（读写编辑搜索）
- HTTP 请求
- JSON 处理
- 变量管理

## 领域知识
[添加领域特定的知识、规则、约束]

## 响应格式
[定义输出格式要求]
```

### Step 3: 保存提示词
```json
platform_api(operation: "save_prompt", params: {
  "prompt": "<生成的提示词内容>",
  "metadata": {
    "version": "1.0.0",
    "scenario": "<场景描述>"
  }
})
```

### Step 4: 验证提示词
1. 检查提示词是否覆盖了所有核心能力
2. 检查是否有歧义或矛盾的指令
3. 检查工具使用说明是否准确
4. 通过 ACP 会话发送测试 prompt 验证效果

## 提示词设计原则
1. **角色明确** — 开头就定义"你是谁"和"你做什么"
2. **能力边界** — 明确能做什么和不能做什么
3. **工具指引** — 说明在什么场景用什么工具
4. **输出规范** — 定义响应格式，减少不确定性
5. **领域约束** — 列出领域特定的规则和限制

## 提示词片段管理
通用规则可以拆分为提示词片段，放在 `prompts/prompt-fragments/`：
- `platform-rules.md` — 平台集成规则
- `tool-usage-rules.md` — 工具使用规则
- 自定义片段按需创建

## Anti-patterns
- ❌ 在 `src/runtime/` 代码中硬编码提示词
- ❌ 修改提示词后不保存到平台
- ❌ 提示词中列出过时的工具名称
- ❌ 没有明确的角色定义和能力边界
- ✅ 基于模板生成，保持结构一致
- ✅ 每次修改后 save_prompt
- ✅ 提示词中的工具名与实际注册的工具对应
