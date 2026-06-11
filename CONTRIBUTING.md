# Contributing to DeepAgents Dev Templates

## 项目结构

这是一个 monorepo，包含以下包：

| 包 | 说明 |
|---|------|
| `packages/deepagents-app-ts` | TypeScript 模板 |
| `packages/deepagents-app-py` | Python 模板 |
| `packages/inspector` | 编排可视化工具 |
| `packages/dev-agent` | 开发 Agent 配置/Skills |

## 开发环境

### 前置要求

- Node.js >= 20
- pnpm 9+
- Python >= 3.11（Python 模板开发）
- uv（Python 包管理器）

### 安装依赖

```bash
# 安装所有依赖
pnpm install

# Python 模板
cd packages/deepagents-app-py
uv sync --group dev
```

## 开发流程

### TypeScript 模板

```bash
cd packages/deepagents-app-ts

# 开发模式
pnpm dev

# 运行测试
pnpm test

# 类型检查
pnpm typecheck

# 代码检查
pnpm lint

# 构建
pnpm build
```

### Python 模板

```bash
cd packages/deepagents-app-py

# 运行 REPL
uv run deepagents-app-py chat

# 运行测试
uv run pytest

# 代码检查
uv run ruff check .

# 类型检查
uv run pyright

# 构建
uv build
```

### Inspector

```bash
cd packages/inspector

# 运行测试
pnpm test

# 启动可视化 UI
pnpm inspect
```

## 代码规范

### TypeScript

- 使用 ES modules（import/export）
- 严格模式 TypeScript
- 工具文件命名：`{name}.tool.ts`
- Skills 使用 `SKILL.md` + YAML frontmatter

### Python

- 使用 Ruff 进行代码检查和格式化
- 使用 Pyright 进行类型检查
- 工具使用 LangChain `@tool` 装饰器

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

```
<type>(<scope>): <description>

[optional body]
[optional footer]
```

### 类型

- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式（不影响功能）
- `refactor`: 重构
- `test`: 测试相关
- `chore`: 构建/工具链变更

### 范围

- `app-ts`: TypeScript 模板
- `app-py`: Python 模板
- `inspector`: Inspector 包
- `dev-agent`: 开发 Agent 配置
- `ci`: CI/CD 相关

### 示例

```
feat(app-py): add checkpoint tool
fix(ci): correct package path references
docs: update README with Python template
```

## 提交 Pull Request

1. Fork 项目
2. 创建特性分支：`git checkout -b feat/my-feature`
3. 提交变更：`git commit -m "feat(scope): description"`
4. 推送分支：`git push origin feat/my-feature`
5. 创建 Pull Request

### PR 要求

- 所有测试通过
- 代码通过 lint 检查
- TypeScript 通过类型检查
- 更新相关文档
- 添加变更日志条目（如适用）

## 打包发布

```bash
# 打包所有模板
pnpm pack:all

# 发布模式（无时间戳）
pnpm pack:release
```

打包产物位于 `zip/` 目录。

## 问题反馈

- 使用 GitHub Issues 报告 Bug
- 使用 GitHub Discussions 进行讨论

## License

MIT
