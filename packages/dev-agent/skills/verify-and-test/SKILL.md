---
name: verify-and-test
description: "完整验证流程：build → typecheck → test → ACP smoke test → graph"
tags: [testing, verification, build, quality]
version: "1.0.0"
---

# 验证与测试

## When to Use
每次开发任务完成后，必须执行完整验证流程。

## 验证流程（必须按顺序执行）

### Step 1: 编译检查
```bash
npm run build
```
- 预期：无错误，`dist/` 目录生成
- 失败处理：修复 TypeScript 错误后重试

常见编译错误：
| 错误码 | 原因 | 修复 |
|--------|------|------|
| TS2307 | 找不到模块 | 检查安装和 `.js` 后缀 |
| TS2345 | 类型不匹配 | 检查 Zod schema 和函数签名 |
| TS2554 | 参数数量错误 | 检查函数签名 |
| TS1343 | `import.meta.url` 问题 | 确认 ESM 配置 |

### Step 2: 类型检查
```bash
npm run typecheck
```
- 预期：无类型错误
- 注意：`build` 已包含类型检查，此步骤可选但推荐单独运行

### Step 3: Lint 检查
```bash
npm run lint
```
- 预期：无 lint 错误
- 失败处理：根据 lint 输出修复代码风格问题

### Step 4: 单元测试
```bash
npm test
```
- 预期：所有测试通过
- 如果新增了工具，需要在 `tests/unit/` 下添加对应测试

测试文件命名：`tests/unit/{module-name}.test.ts`

测试结构（Arrange/Act/Assert）：
```typescript
import { describe, it, expect } from "vitest";

describe("myTool", () => {
  it("should handle valid input", async () => {
    // Arrange
    const input = { param1: "test" };
    // Act
    const result = await myTool.invoke(input);
    // Assert
    expect(result).toContain("success");
  });
});
```

### Step 5: ACP Smoke Test
```bash
npm run test:acp-smoke
```
- 预期：ACP 服务器能正确处理 initialize 和 session/new 请求
- 验证 ACP 协议兼容性（不调用 LLM）

### Step 6: 代码图生成
```bash
npm run graph
```
- 预期：生成 JSON，无错误
- 检查新工具/技能是否出现在图中

### Step 7: 综合检查
手动检查清单：
- [ ] 没有 `any` 类型
- [ ] 没有硬编码密钥
- [ ] 所有导入路径带 `.js` 后缀
- [ ] 新工具有 Zod schema + `.describe()`
- [ ] 新技能有正确的 YAML frontmatter
- [ ] 提示词已通过 `save_prompt` 保存
- [ ] 变量已通过 `agent_variable` 创建

## 验证结果报告
```
✅ 验证结果：
| 检查项 | 结果 |
|--------|------|
| build | ✅ 通过 |
| typecheck | ✅ 通过 |
| lint | ✅ 通过 |
| test | ✅ N/N 通过 |
| acp-smoke | ✅ 通过 |
| graph | ✅ 生成成功 |
| 代码规范 | ✅ 无违规 |

需要用户操作：
- 填写 WEATHER_API_KEY 变量值
- 确认 MCP weather-server 配置
```

## 失败处理
1. **编译失败** → 读错误信息 → 修复代码 → 重新 build
2. **测试失败** → 读测试输出 → 定位失败用例 → 修复逻辑或测试
3. **类型错误** → 检查 Zod schema 是否与 TypeScript 类型一致
4. **依赖缺失** → `npm install <package>` → 重新 build

## Anti-patterns
- ❌ 跳过验证直接报告完成
- ❌ 只跑 build 不跑 test
- ❌ 测试失败后声明"基本完成"
- ❌ 不检查代码规范（any 类型、硬编码密钥）
- ✅ 按顺序执行所有验证步骤
- ✅ 所有步骤通过后才报告完成
- ✅ 失败时给出具体错误和修复方案
