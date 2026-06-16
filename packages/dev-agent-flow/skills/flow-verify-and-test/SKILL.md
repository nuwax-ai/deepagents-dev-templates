---
name: flow-verify-and-test
description: "flow-ts 完整验证流程：build -> typecheck -> test（含分层守卫）-> ACP 冒烟（rcoder-cli 各示例入口）-> graph"
tags: [testing, verification, build, quality, flow]
version: "3.0.0"
---

# 验证与测试（Flow 版）

## When to Use
每次开发任务完成后，必须执行完整验证流程。

## 通用验证原则
1. **按顺序执行** — build -> typecheck -> test -> smoke -> graph
2. **全部通过后** 才能报告完成
3. **失败时给出** 具体错误和修复方案

## 综合检查清单
- [ ] 没有硬编码密钥
- [ ] 新工具有 Zod schema + 字段描述
- [ ] 新技能有正确的 YAML frontmatter
- [ ] 提示词已通过 save_prompt 保存
- [ ] 变量已通过 agent_variable 创建
- [ ] 决策函数（条件边路由）有单测
- [ ] 节点名不与 state channel 同名
- [ ] 没有 `any` 类型
- [ ] 导入路径带 `.js` 后缀
- [ ] 分层 import 合规（不 app->surfaces/compose；layering.test.ts 通过）
- [ ] runtime 自包含（无 vendor/ 引用、无仓库外路径）

## Step 1: 编译检查
```bash
pnpm build
```
常见编译错误：
| 错误码 | 原因 | 修复 |
|--------|------|------|
| TS2307 | 找不到模块 | 检查安装和 `.js` 后缀 |
| TS2345 | 类型不匹配 | 检查 Zod schema 和函数签名 |
| TS2554 | 参数数量错误 | 检查函数签名 |

## Step 2: 类型检查
```bash
pnpm typecheck          # src
pnpm typecheck:examples # examples + src
```

## Step 3: 单元测试
```bash
pnpm test
```
> `tests/layering.test.ts` 是**分层守卫**：强制 core → runtime → app → {surfaces|compose} 的 import 方向。违规（如 app import surfaces）会让测试变红。加节点/工具时注意放对层。
决策函数（条件边路由）应抽纯函数 + 单测：
```typescript
import { describe, it, expect } from "vitest";
import { routeAfterGrade } from "../graph.js";

describe("routing", () => {
  it("relevant -> generate", () => {
    expect(routeAfterGrade({ relevant: true } as any)).toBe("generate");
  });
  it("not relevant -> rewrite", () => {
    expect(routeAfterGrade({ relevant: false } as any)).toBe("rewrite");
  });
});
```
真实 LLM 调用的集成测试用 `skipIf` 无凭证自动跳过：
```typescript
const hasCreds = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
describe.skipIf(!hasCreds)("integration", () => { ... });
```

## Step 4: ACP Smoke Test
> 前提：`pnpm build`（或 `pnpm bundle` 生成 dist/bundle.mjs）。

### 快速冒烟
```bash
pnpm smoke:acp              # 默认 flow
pnpm smoke:dev-agent        # 指定示例入口（rag/travel/pm/review/research 同理）
# 或手动
pnpm dlx rcoder-cli chat -c "node dist/bundle.mjs" -w . -p "hello" --timeout 30 --mode yolo -q
```
agent 有响应、exit 0 即说明本次改动没有破坏启动流程。
`--entry` 或 `AGENT_ENTRY` 可指向任意 flow 入口：
```bash
node scripts/smoke-acp.mjs --entry examples/my-flow/index.ts
```

### 交互式对话调试（多轮验证 HITL）
```bash
pnpm dlx rcoder-cli tui -c "node dist/bundle.mjs" -w .
```
StatefulFlow 的 interrupt/resume 可多轮验证。加 `-vv` 看详细日志。

### 凭证差异（重要）
| | 默认图（src/app） | 示例（examples/*） |
|--|------------------|-------------------|
| 无凭证 | 有 fallback（回显输入），可跑 | 无 fallback，直接报错 |
| 冒烟测试 | 不需凭证也能跑 | 需配 `.env` 凭证 |

### 常见冒烟失败
| 错误 | 原因 | 修复 |
|------|------|------|
| `dist/bundle.mjs` not found | 未 build/bundle | `pnpm build` 或 `pnpm bundle` |
| 示例报错无 fallback | 示例真调 LLM | 配 `.env` 凭证 |
| `model_provider is None` | `.env` 缺 API Key | 填 OPENAI/ANTHROPIC_API_KEY |
| timeout | ACP 握手无响应 | 加 `-vv` 看日志 |

## Step 5: 图拓扑导出
```bash
pnpm graph              # JSON
pnpm graph --mermaid    # Mermaid 源
```
验证节点连线与设计一致，条件边正确标注。

## Step 6: 能力查询
```bash
pnpm exec tsx src/index.ts capabilities   # 工具/MCP/skills（无凭证）
pnpm exec tsx src/index.ts sessions       # 已持久化会话
```

## 验证结果报告
```
验证结果：
| 检查项 | 结果 |
|--------|------|
| build | 通过 |
| typecheck | 通过 |
| test | N/N 通过 |
| acp-smoke | 通过 |
| graph | 生成成功 |
| 代码规范 | 无违规 |
```

## 失败处理
| 场景 | 修复 |
|------|------|
| 依赖缺失 | `pnpm install <pkg>` |
| 编译失败 | 修 TS 错误 |
| 测试失败 | 读 vitest 输出 -> 修复 |
| 类型错误 | 检查 Zod <-> TS 类型一致 |
| 节点名冲突 | 改节点名（不能与 channel 同名） |
| 示例无凭证报错 | 配 `.env`（示例无 fallback） |

## Anti-patterns
- 跳过验证直接报告完成
- 只跑 build 不跑 test
- 决策函数不写单测
- ✅ 按顺序执行所有步骤
- ✅ 决策函数有纯函数单测
- ✅ 真实 LLM 测试用 skipIf 无凭证跳过
