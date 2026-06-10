---
name: verify-and-test
description: "完整验证流程：build → typecheck → test → ACP smoke test → graph（TS / Python 通用）"
tags: [testing, verification, build, quality]
version: "3.0.0"
---

# 验证与测试

## When to Use
每次开发任务完成后，必须执行完整验证流程。

> **注意**：先用 `template-init` 技能确认当前项目类型，再按对应流程执行。

---

## 通用验证原则

1. **按顺序执行** — build → lint → test → smoke → graph
2. **全部通过后** 才能报告完成
3. **失败时给出** 具体错误和修复方案

### 综合检查清单（通用）

- [ ] 没有硬编码密钥
- [ ] 新工具有 schema + 字段描述
- [ ] 新技能有正确的 YAML frontmatter
- [ ] 提示词已通过 `save_prompt` 保存
- [ ] 变量已通过 `agent_variable` 创建

### 验证结果报告

```
✅ 验证结果：
| 检查项 | 结果 |
|--------|------|
| build | ✅ 通过 |
| lint | ✅ 通过 |
| typecheck | ✅ 通过 |
| test | ✅ N/N 通过 |
| acp-smoke | ✅ 通过 |
| graph | ✅ 生成成功 |
| 代码规范 | ✅ 无违规 |
```

---

## TypeScript 模板验证

### Step 1: 编译检查
```bash
pnpm run build
```
常见编译错误：
| 错误码 | 原因 | 修复 |
|--------|------|------|
| TS2307 | 找不到模块 | 检查安装和 `.js` 后缀 |
| TS2345 | 类型不匹配 | 检查 Zod schema 和函数签名 |
| TS2554 | 参数数量错误 | 检查函数签名 |
| TS1343 | `import.meta.url` 问题 | 确认 ESM 配置 |

### Step 2: 类型检查
```bash
pnpm run typecheck
```

### Step 3: Lint 检查
```bash
pnpm run lint
```

### Step 4: 单元测试
```bash
pnpm test
```
测试文件命名：`tests/unit/{module-name}.test.ts`

```typescript
import { describe, it, expect } from "vitest";

describe("myTool", () => {
  it("should handle valid input", async () => {
    const input = { param1: "test" };
    const result = await myTool.invoke(input);
    expect(result).toContain("success");
  });
});
```

### Step 5: ACP Smoke Test
```bash
pnpm run test:acp-smoke
```

### Step 6: 代码图生成
```bash
pnpm run graph
```

### TS 专属检查项
- [ ] 没有 `any` 类型
- [ ] 所有导入路径带 `.js` 后缀
- [ ] 新工具有 Zod schema + `.describe()`

---

## Python 模板验证

### Step 1: Lint 检查
```bash
uv run ruff check .
```
- 预期：无 lint 错误
- 自动修复：`uv run ruff check --fix .`

### Step 2: 类型检查
```bash
uv run pyright
```
- 预期：0 errors

### Step 3: 单元测试
```bash
uv run pytest
```
测试文件命名：`tests/unit/test_{module}.py`

```python
import pytest

def test_my_tool():
    # Arrange
    input_data = {"param1": "test"}
    # Act
    result = my_tool(input_data)
    # Assert
    assert "success" in result
```

### Step 4: 构建检查
```bash
uv build
```
- 预期：生成 wheel + sdist 无错误

### Step 5: ACP Smoke Test
```bash
pnpm dlx rcoder-cli chat \
  -c "uv run deepagents-app-py" \
  -w . -p "hello" --timeout 30 --mode yolo -q
```

### Python 专属检查项
- [ ] 没有 `Any` 类型注解（除非必要）
- [ ] 所有函数有类型注解
- [ ] 工具 `parameters` 中每个字段有 `"description"`

---

## 失败处理

| 场景 | TS 修复 | Python 修复 |
|------|---------|------------|
| 依赖缺失 | `pnpm install <pkg>` | `uv add <pkg>` |
| 编译失败 | 修 TypeScript 错误 | 修 Python 语法/类型 |
| 测试失败 | 读 vitest 输出 → 修复 | 读 pytest 输出 → 修复 |
| 类型错误 | 检查 Zod ↔ TS 类型一致 | 检查 JSON Schema ↔ Python 类型 |

## Anti-patterns
- ❌ 跳过验证直接报告完成
- ❌ 只跑 build 不跑 test
- ❌ 测试失败后声明"基本完成"
- ❌ 不检查代码规范
- ✅ 按顺序执行所有验证步骤
- ✅ 所有步骤通过后才报告完成
- ✅ 失败时给出具体错误和修复方案
