/**
 * Flow spec 的 zod schema —— 一句话生成的「结构化输入」契约。
 *
 * 设计:**拓扑预设 + 槽位参数**。spec 选定 topology(预设的经测试拓扑),只填该拓扑的
 * 少量槽位(systemPrompt / tools / params),而非自由设计任意节点图——这就是「收窄生成
 * 空间」：让弱模型做选择题 + 填空，而不是作文题。
 *
 * 每新增一个拓扑：在 specSchema 的 discriminatedUnion 里加一个成员，并在 generate.mjs
 * 的 BLUEPRINTS 里注册对应渲染器。
 */
import { z } from "zod";

/** 工具引用：平台工具（Plugin/Workflow/Knowledge，经 agent-dev-config 配置）或内置工具名。 */
const toolRefSchema = z.union([
  z.object({ builtin: z.string() }),
  z.object({
    type: z.enum(["Plugin", "Workflow", "Knowledge"]),
    targetId: z.number(),
  }),
]);

/** 所有拓扑共有的基础字段。 */
const base = {
  name: z
    .string()
    .regex(/^[a-z][a-z0-9-]*$/, "name 必须 kebab-case（小写字母开头，仅小写字母/数字/连字符）"),
  description: z.string().default(""),
  flowType: z.enum(["oneshot", "stateful"]).default("oneshot"),
  /** 目标 Agent 系统提示词（建议由 flow-prompt-designer 产出）。 */
  systemPrompt: z.string().default(""),
  tools: z.array(toolRefSchema).default([]),
};

/**
 * custom 拓扑的节点级编排 spec —— state/nodes/edges/input/result。
 * spec 即契约：custom blueprint 在**生成时**把 spec 渲染成真实 graph.ts（catalog factory + prompt/route
 * 内联为受 tsc 检查的真实代码，非运行时解释）。node.type 词表见 docs/node-catalog.md。
 */
const customChannelSchema = z.object({
  type: z.enum(["string", "number", "boolean", "string-array-append", "any-last"]),
  default: z.unknown().optional(),
});
const customNodeSchema = z.object({
  // custom blueprint 渲染支持的节点 type（llm-stream/tool-exec/subgraph 暂不支持 → 用别的 type 或生成后手改）
  type: z.enum([
    "llm",
    "llm-router",
    "approval",
    "approval-finalize",
    "mcp-retrieval",
    "prepare",
    "passthrough",
  ]),
  /** factory 选项；回调（prompt/write/route/retrieve/question）为箭头函数字符串，生成时内联为真实代码（受 tsc 检查，非运行时 eval）。 */
  params: z.record(z.string(), z.unknown()).default({}),
});
const customEdgeSchema = z.union([
  z.object({ kind: z.literal("static"), from: z.string(), to: z.string() }),
  z.object({
    kind: z.literal("conditional"),
    from: z.string(),
    /** 条件函数体（箭头函数字符串，返回目标节点名）。 */
    condition: z.string(),
    targets: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("fanout"),
    from: z.string(),
    target: z.string(),
    items: z.string(),
    input: z.string(),
  }),
]);
const customParamsSchema = z.object({
  /** State channels（reducer 类型别名）。 */
  state: z.record(z.string(), customChannelSchema),
  /** 节点名 → {type, params}。 */
  nodes: z.record(z.string(), customNodeSchema),
  edges: z.array(customEdgeSchema),
  input: z
    .object({ queryField: z.string().default("query"), extra: z.record(z.string(), z.unknown()).optional() })
    .default({}),
  result: z
    .object({ answerField: z.string().default("output"), footerField: z.string().optional() })
    .default({}),
  recursionLimit: z.number().optional(),
});

/**
 * spec 主 schema —— 按 topology 区分 params（discriminated union）。
 * 当前已实现：react-tools。其余拓扑陆续加成员（见 SUPPORTED_TOPOLOGIES）。
 */
export const specSchema = z.discriminatedUnion("topology", [
  // 标准 ReAct：prepare → think ↔ tools → respond（客服 / 任务工具型）。
  z.object({
    ...base,
    topology: z.literal("react-tools"),
    params: z.object({}).default({}),
  }),
  // 人审定稿：compose → review(interrupt) → finalize（审批 / 校对 / 可控生成）。
  z.object({
    ...base,
    topology: z.literal("human-in-loop"),
    params: z.object({}).default({}),
  }),
  // 项目管理：plan → estimate → evaluate(重做) → approve(interrupt) → finalize（reflection + HITL）。
  z.object({
    ...base,
    topology: z.literal("project-manager"),
    params: z.object({}).default({}),
  }),
  // 旅行规划：gather → ⟨Send 并行⟩ research×4 → aggregate → confirm(interrupt) → finalize（Map-reduce + HITL）。
  z.object({
    ...base,
    topology: z.literal("travel-planner"),
    params: z.object({}).default({}),
  }),
  // 检索增强：rewrite → retrieve(MCP) → grade(重试) → prepare → generate（one-shot）。
  z.object({
    ...base,
    topology: z.literal("rag"),
    params: z
      .object({
        /** 检索源 MCP 服务器（语义名 → stdio MCP 配置）。 */
        mcpServers: z.record(z.string(), z.unknown()).default({}),
      })
      .default({}),
  }),
  // 深度研究：clarify → plan → outline_gate →(Send) research → review → draft → converse → delivery（多阶段 stateful）。
  z.object({
    ...base,
    topology: z.literal("deep-research"),
    params: z.object({}).default({}),
  }),
  // dev-agent：复用默认 ReAct 图 + 多轮续接 + 压缩（手写 run-loop，stateful-custom）。
  z.object({
    ...base,
    topology: z.literal("dev-agent"),
    params: z.object({}).default({}),
  }),
  // 节点级编排：spec 声明 state/nodes/edges → 生成时渲染成真实 graph.ts（catalog factory + 内联代码，stateful-recipe）。
  z.object({
    ...base,
    topology: z.literal("custom"),
    params: customParamsSchema,
  }),
]);

/** 当前 schema 已声明的拓扑（供 CLI 提示）。 */
export const SUPPORTED_TOPOLOGIES = specSchema.options.map((o) => o.shape.topology.value);

/** 校验 spec；失败抛出聚合的可读错误。 */
export function parseSpec(raw) {
  const r = specSchema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    throw new Error(`spec 校验失败：\n${msg}`);
  }
  return r.data;
}
