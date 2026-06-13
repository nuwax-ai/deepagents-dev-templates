/**
 * Flow 执行器接口 —— surface(ACP/CLI) 与具体图解耦的关键 seam。
 *
 * 包默认图、examples/rag 各自实现一个 FlowExecutor 插进同一套 surface，
 * 避免重复 DeepAgentsServer / onPrompt / 流式 等 plumbing。
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

/** 回调集合（流式 token + 工具调用事件）——one-shot 与 stateful flow 共用。 */
export interface FlowCallbacks {
  onToken?: (token: string) => void | Promise<void>;
  onToolCall?: (e: ToolCallEvent) => void | Promise<void>;
}

/**
 * Flow 执行器（one-shot）：给定查询产出结果。
 * - onToken：流式推送回答增量（surface 据此决定是否再整段重发 answer）。
 * - onToolCall：推送工具调用事件（如检索），surface 据此向客户端发 ACP tool_call。
 */
export type FlowExecutor = (query: string, opts: FlowCallbacks) => Promise<FlowResult>;

/**
 * 有状态 flow —— 支持 human-in-the-loop（interrupt / resume）。
 *
 * 与 one-shot FlowExecutor 互补：executor 跑完即结束；StatefulFlow 可在中途 `interrupt`
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
}
