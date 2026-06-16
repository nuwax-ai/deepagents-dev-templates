/**
 * Surface Stream Events —— LangGraph 多模式 stream chunk 归一后的 surface 内部事件。
 *
 * 用途：ACP / CLI 不再各自解析原生 stream 事件，统一消费这组归一结构。
 * 这是 surface 内部薄契约，不是新的执行抽象（执行仍是 graph.stream）。
 */

export type SurfaceStreamEvent =
  /** 模型文本增量（messages mode，回答节点）。 */
  | { type: "text"; text: string }
  /** 工具开始（tools mode 的 ToolNode，或 custom mode 自定义检索）。 */
  | { type: "tool_start"; id: string; name: string; input?: unknown }
  /** 工具完成/失败。 */
  | {
      type: "tool_update";
      id: string;
      status: "completed" | "failed";
      output?: unknown;
      error?: string;
    }
  /** 长任务阶段进度（custom mode 的 config.writer({type:"stage"})）。 */
  | { type: "stage"; stage: string; index?: number; total?: number; detail?: string }
  /** HITL 暂停（updates mode 的 __interrupt__）。 */
  | { type: "interrupt"; question: string };
