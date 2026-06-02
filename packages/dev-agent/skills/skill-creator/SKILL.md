---
name: skill-creator
description: "创建新技能 SKILL.md：YAML frontmatter 格式、目录约定、渐进加载"
tags: [skills, markdown, meta, creation]
version: "1.0.0"
---

# 技能创建器

## When to Use
需要为场景 Agent 创建新的操作技能时使用。

## 创建步骤

### Step 1: 确定技能分类
- `skills/builtin/` — 通用开发技能（代码审查、调试、测试等）
- `skills/platform/` — 平台集成技能（ACP 调试、MCP 配置等）

### Step 2: 创建目录和文件
```
skills/{category}/{skill-name}/
└── SKILL.md    # 必须
```

命名规则：
- 小写 + 连字符：`my-skill-name`
- 最长 64 字符
- 正则：`^[a-z0-9]+(-[a-z0-9]+)*$`

### Step 3: 编写 SKILL.md

```markdown
---
name: my-skill-name
description: "一句话说明什么场景下使用此技能"
tags: [tag1, tag2, tag3]
version: "1.0.0"
---

# 技能标题

## When to Use
明确描述触发条件。

## 步骤 / 操作指南
1. 第一步：具体做什么
2. 第二步：具体做什么
3. ...

## 示例
```typescript
// 具体代码示例
```

## 常见问题
| 问题 | 原因 | 解决 |
|------|------|------|
| ... | ... | ... |

## Anti-patterns
- ❌ 错误做法
- ✅ 正确做法
```

### YAML Frontmatter 规范
| 字段 | 必须 | 说明 |
|------|------|------|
| `name` | ✅ | 小写连字符，匹配目录名 |
| `description` | ✅ | 一句话，最长 1024 字符，说明使用场景 |
| `tags` | ✅ | 关键词数组，用于技能发现 |
| `version` | ✅ | 语义化版本号 |

### 内容质量要求
- **可操作** — 给具体步骤，不给抽象建议
- **有示例** — 代码片段、命令、配置
- **有反模式** — 明确列出什么不该做
- **有故障排除** — 常见错误和解决方案
- **控制篇幅** — 不超过 500 行

### 渐进加载说明
技能采用渐进加载机制：
1. Agent 只看到 `name` 和 `description`
2. 需要时才加载完整 SKILL.md 内容
3. **description 必须足够清晰**，让 Agent 知道何时需要加载

## Anti-patterns
- ❌ description 写得太模糊，Agent 不知道何时加载
- ❌ 步骤太抽象，没有具体命令或代码
- ❌ 超过 500 行（应该拆分为多个技能）
- ❌ 没有 Anti-patterns 部分
- ✅ description 用"当...时使用"的句式
- ✅ 每个步骤都有具体操作
- ✅ 包含代码示例和故障排除
