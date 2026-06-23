/**
 * Flow 契约（core 层）—— graph 与 surface 之间的共享词汇，**纯类型、零依赖**。
 *
 * 这是分层架构的最底契约层（L1 core）：app（默认图）与 surfaces（ACP/CLI）都 import
 * 这里的类型，从而**互不直接依赖**。包默认图、examples/* 各自实现一个 FlowExecutor /
 * StatefulFlow 插进同一套 surface，避免重复 DeepAgentsServer / onPrompt / 流式 等 plumbing。
 *
 * 历史路径 `surfaces/flow-types.ts` 现为本文件的 re-export shim（examples 与对外消费者仍可用）。
 */

/** flow 执行结果：answer 为完整回答，footer 为可选脚注（如来源列表）。 */
export interface FlowResult {
  answer: string;
  footer?: string;
}

/** 一次工具调用事件（如 retrieve 调 MCP 检索源）。surface 据此向客户端展示「工具调用过程」。 */
export interface ToolCallEvent {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "in_progress" | "completed" | "failed";
  /** completed 时的结果（文本或对象，会序列化展示） */
  result?: unknown;
  /** failed 时的错误信息 */
  error?: string;
}

/** ACP Plan 单条条目（与 deepagents-acp PlanEntry 对齐）。 */
export interface PlanEntry {
  content: string;
  priority?: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed" | "skipped";
}

/** 结构化 Plan 更新（研究大纲 / 任务清单）。 */
export interface PlanEvent {
  entries: PlanEntry[];
}

/**
 * 阶段/进度事件 —— 长任务多阶段流水线（如 plan → research → draft → review）的可视化。
 * 与 ToolCallEvent 互补：tool 事件是「调了什么外部能力」，stage 事件是「现在走到流水线哪一步」。
 * surface 据此给客户端推进度（CLI 打印 / ACP 发 message chunk）。节点经
 * `config.configurable.onStage` 触发（与 onToolCall 同机制，可穿透 Send 并行实例）。
 */
export interface StageEvent {
  /** 阶段名（如 "调研" / "撰写初稿" / "质量评审"）。 */
  stage: string;
  /** 可选：当前第几步（1-based）。 */
  index?: number;
  /** 可选：总步数。 */
  total?: number;
  /** 可选：本步细节（如正在调研的章节标题）。 */
  detail?: string;
}

/**
 * 回调集合（流式 token + 工具调用 + 阶段 + Plan）——FlowExecutor 与 StatefulFlow 共用。
 * signal（可选）：任务取消信号。surface 从 ACP cancel controller 取，透传到
 * `graph.stream({signal})`；中止时 LangGraph 以 AbortError reject，surface 据此快速收尾。
 */
export interface FlowCallbacks {
  onToken?: (token: string, source?: string) => void | Promise<void>;
  onToolCall?: (e: ToolCallEvent) => void | Promise<void>;
  /** 长任务阶段推进（可选）。 */
  onStage?: (e: StageEvent) => void | Promise<void>;
  /** 结构化 Plan 更新（ACP sessionUpdate: plan）。 */
  onPlan?: (e: PlanEvent) => void | Promise<void>;
  /** 任务取消信号（可选）。被中止时底层图运行 reject，不再继续产出 token。 */
  signal?: AbortSignal;
}

/**
 * Flow 执行器（单次调用）：给定查询产出结果。
 * - onToken：流式推送回答增量（surface 据此决定是否再整段重发 answer）。
 * - onToolCall：推送工具调用事件（如检索），surface 据此向客户端发 ACP tool_call。
 */
export type FlowExecutor = (query: string, opts: FlowCallbacks) => Promise<FlowResult>;

/**
 * 有状态 flow —— 支持 human-in-the-loop（interrupt / resume）。
 *
 * 与 FlowExecutor（单次）互补：executor 跑完即结束；StatefulFlow 可在中途 `interrupt`
 * 暂停、把问题抛给用户，下一轮带 `resume` 恢复（节点从暂停点之后续跑）。
 * threadId 隔离多会话（ACP 用 sessionId），图状态由 checkpointer 持久化。
 *
 * 一次 run 的结果只有两种：
 *  - done：跑到底，answer 为最终回答；
 *  - interrupted：图在某节点 interrupt 暂停，question 是要问用户的话（surface 发给用户、等下一轮 resume）。
 */
export type FlowRunResult =
  | { status: "done"; answer: string; footer?: string }
  | { status: "interrupted"; question: string };

export interface StatefulFlow {
  run(
    input: { query?: string; resume?: string },
    threadId: string,
    callbacks?: FlowCallbacks
  ): Promise<FlowRunResult>;
  /**
   * 该 thread 是否**已经开始过**（checkpointer 里已有该会话的 checkpoint）。可选。
   *
   * 长任务关键 seam：surface 据此判断「下一条用户消息是续跑、还是开新任务」。
   * **一个会话 = 一个主题/项目**：首条消息开题（无 checkpoint → 新任务），之后每条都续跑同一项目
   * （有 checkpoint → resume），无论它停在 interrupt、错在某节点、还是已跑完——
   * 都不会被误当成「新主题」重头开始。
   *
   * 实现应**从 checkpointer 状态推断**（`graph.getState()` 是否有 checkpoint），而非进程内存——
   * 这样进程/IDE 重启后仍准（见 createStatefulFlow）。未实现时 surface 退回内存跟踪。
   */
  hasStarted?(threadId: string): Promise<boolean>;
}

/**
 * 图拓扑反射的结构化产物（getFlowTopology / 各拓扑 getXxxTopology 返回）。
 *
 * 放 core（纯契约）：app/topology 与 libs/topologies 都要产出/消费它，libs 不能 import app，
 * 故契约下沉 core。app/topology.ts re-export 以维持公开 `deepagents-flow-ts/topology` 子路径。
 */
export interface FlowTopologyNode {
  id: string;
  label: string;
}

export interface FlowTopologyEdge {
  source: string;
  target: string;
  /** 条件边(addConditionalEdges)为 true，普通边为 false。 */
  conditional: boolean;
  /** 条件分支标签(如路由目标名)；普通边无标签。 */
  label?: string;
}

export interface FlowTopology {
  nodes: FlowTopologyNode[];
  edges: FlowTopologyEdge[];
  /** 同一拓扑的 Mermaid 源，可直接渲染 / 贴进文档。 */
  mermaid: string;
}
