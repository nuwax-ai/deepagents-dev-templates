---
name: template-init
description: "检测模板项目结构、识别编辑区域、理解配置优先级链"
tags: [template, init, structure, zones]
version: "1.0.0"
---

# 模板初始化检测

## When to Use
开始任何开发任务前，必须先执行此技能了解项目结构。

## 检测步骤

### Step 1: 确认模板类型
读取 `package.json`，检查：
- `name` 是否包含 `deepagents`
- `dependencies` 是否包含 `deepagents` 和 `deepagents-acp`
- `type` 是否为 `"module"`（ESM）

### Step 2: 读取模板清单
读取 `template.manifest.json`，了解：
- 区域划分（protected / ai-editable / user-editable）
- 验收命令列表
- 约束条件（promptSource、toolPriority、variableCreation）

### Step 3: 扫描目录结构
```
src/runtime/  → 🚫 保护区（列出文件，确认不修改）
src/app/      → ✅ AI 可编辑区（列出现有工具、适配器）
skills/       → ✅ 技能目录（列出 builtin/ 和 platform/ 下的技能）
prompts/      → ✅ 提示词目录（列出系统提示词和片段）
config/       → ⚙️ 用户配置（读取 app-agent.config.json）
```

### Step 4: 读取当前配置
```json
// config/app-agent.config.json 关键字段
{
  "agent": { "name", "description", "version" },
  "model": { "provider", "name", "baseUrl" },
  "mcp": { "configPath", "mergeStrategy" },
  "permissions": { "interruptOn", "allowedPaths", "deniedPaths" }
}
```

### Step 5: 读取平台状态
检查是否有平台凭据：
- `PLATFORM_AGENT_ID` 和 `PLATFORM_SPACE_ID` 是否配置
- 是否连接到 nuwaclaw 平台（local-only 模式 vs platform 模式）

## 输出格式
```
📋 模板检测结果：
- 模板版本：X.Y.Z
- Agent 名称：xxx
- 模式：local-only / platform
- 现有工具：N 个（列出名称）
- 现有技能：N 个（列出名称）
- MCP 服务器：N 个（列出名称）
- 待处理事项：（如有缺失配置）
```

## Anti-patterns
- ❌ 跳过检测直接写代码 — 可能误改保护区
- ❌ 忽略 template.manifest.json — 这是约束的唯一来源
- ✅ 每次开发任务开始前都执行检测
- ✅ 检测结果作为后续开发步骤的输入
