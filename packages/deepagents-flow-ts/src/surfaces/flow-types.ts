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

/**
 * Flow 执行器：给定查询产出结果。
 * - onToken：流式推送回答增量（surface 据此决定是否再整段重发 answer）。
 * - onToolCall：推送工具调用事件（如检索），surface 据此向客户端发 ACP tool_call。
 */
export type FlowExecutor = (
  query: string,
  opts: {
    onToken?: (token: string) => void | Promise<void>;
    onToolCall?: (e: ToolCallEvent) => void | Promise<void>;
  }
) => Promise<FlowResult>;
