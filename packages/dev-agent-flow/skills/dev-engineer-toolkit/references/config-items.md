# 项目配置项参考

> 本文档描述智能体项目中的所有可配置项及其用途。

## 核心配置

### system_prompt

- **类型**: string（支持多行文本）
- **说明**: 系统提示词，定义智能体的行为准则、角色设定和能力边界。这是最核心的配置项，直接影响智能体的输出质量。
- **示例**:

```
你是一个专业的软件开发助手，精通多种编程语言和框架。
你的职责是帮助用户编写高质量、可维护的代码。
```

### welcome_message

- **类型**: string
- **说明**: 开场白/欢迎语，用户首次进入对话时智能体发送的第一条消息。
- **示例**: `你好！我是你的开发助手，我可以帮你编写代码、调试问题、审查代码。请告诉我你需要什么帮助？`

---

## 模型配置

### model

- **类型**: string（枚举）
- **说明**: 默认使用的 AI 模型。
- **可选值**: 根据平台支持的模型列表而定（如 `claude-sonnet-4-6`, `claude-opus-4-8` 等）

### temperature

- **类型**: float (0-2)
- **说明**: 模型温度参数，控制输出的随机性。值越低输出越确定性，值越高越有创造性。
- **默认值**: 0.7

### max_tokens

- **类型**: int
- **说明**: 单次响应的最大输出 Token 数。
- **默认值**: 4096

### top_p

- **类型**: float (0-1)
- **说明**: 核采样参数，与 temperature 配合使用控制输出多样性。
- **默认值**: 1.0

---

## 工具与技能配置

### tools

- **类型**: JSON array
- **说明**: 启用的工具列表，控制智能体可以调用的工具集合。
- **示例**:

```json
[
  {"name": "file_search", "enabled": true},
  {"name": "code_execution", "enabled": true},
  {"name": "web_fetch", "enabled": false}
]
```

### skills

- **类型**: JSON array
- **说明**: 启用的技能列表，控制智能体可以使用的技能集合。
- **示例**:

```json
[
  {"name": "code-review", "enabled": true},
  {"name": "test-generator", "enabled": true}
]
```

---

## 界面配置

### display_name

- **类型**: string
- **说明**: 智能体在界面上显示的名称。

### avatar

- **类型**: string (URL)
- **说明**: 智能体的头像图片 URL。

### theme_color

- **类型**: string (hex color)
- **说明**: 界面主题色。
- **示例**: `#4A90D9`

---

## 高级配置

### max_context_length

- **类型**: int
- **说明**: 上下文窗口最大长度（Token 数）。

### rate_limit

- **类型**: int
- **说明**: 每分钟最大请求次数限制。

### allowed_domains

- **类型**: JSON array
- **说明**: 允许访问的外部域名白名单（用于 web_fetch 等工具）。

```json
["api.github.com", "docs.python.org", "pypi.org"]
```

---

## 更新注意事项

- 配置更新后立即生效，无需重启项目。
- 更新 `system_prompt` 后，新对话使用新提示词，已有对话不受影响。
- 更新 `tools` 或 `skills` 列表后需确保对应的工具/技能在平台中已注册。
- 修改 `model` 配置时请注意模型可用性和配额。
