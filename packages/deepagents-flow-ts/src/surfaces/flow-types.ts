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

/**
 * Flow 执行器：给定查询产出结果。
 * 若实现支持流式，则调用 onToken 推送增量（surface 据此决定是否再整段重发 answer）。
 */
export type FlowExecutor = (
  query: string,
  opts: { onToken?: (token: string) => void | Promise<void> }
) => Promise<FlowResult>;
