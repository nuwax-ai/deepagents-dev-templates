/**
 * dispatchSurfaceEvent —— 把归一后的 SurfaceStreamEvent 分发给 FlowCallbacks。
 *
 * stateful-flow 多模式 stream 与 ACP surface 共用，避免两处重复映射逻辑。
 */

import type { FlowCallbacks } from "../core/flow-types.js";
import type { SurfaceStreamEvent } from "./stream-events.js";

/**
 * 仅对用户可见的回答节点放行 messages mode 文本（避免 plan/review JSON token 泄漏）。
 *
 * 默认 ReAct 图的最终回答在 `think` 节点产生（无 tool_calls 分支直接回答，respond 仅转存
 * output）——故 think 也放行。工具决策轮 think 的 content 通常为空（emitTextToken 对空串 no-op），
 * 不会把中间推理吐给用户。
 */
export const STREAM_TEXT_NODES = new Set(["write_draft", "respond", "respondNode", "think"]);

/**
 * 将单个 surface 事件分发给 callbacks。
 * @param metadata LangGraph messages mode 附带的 metadata（含 langgraph_node）。
 */
export async function dispatchSurfaceEvent(
  event: SurfaceStreamEvent,
  callbacks: FlowCallbacks | undefined,
  metadata?: { langgraph_node?: string }
): Promise<void> {
  if (!callbacks) return;

  switch (event.type) {
    case "text": {
      const node = metadata?.langgraph_node;
      // custom writer 的 text 无 metadata，直接透出；messages mode 需过滤节点。
      if (node && !STREAM_TEXT_NODES.has(node)) return;
      await callbacks.onToken?.(event.text);
      break;
    }
    case "plan":
      await callbacks.onPlan?.({ entries: event.entries });
      break;
    case "stage":
      await callbacks.onStage?.({
        stage: event.stage,
        index: event.index,
        total: event.total,
        detail: event.detail,
      });
      break;
    case "tool_start":
      await callbacks.onToolCall?.({
        toolCallId: event.id,
        toolName: event.name,
        args:
          event.input && typeof event.input === "object" && !Array.isArray(event.input)
            ? (event.input as Record<string, unknown>)
            : { input: event.input },
        status: "in_progress",
      });
      break;
    case "tool_update":
      await callbacks.onToolCall?.({
        toolCallId: event.id,
        toolName: event.id,
        args: {},
        status: event.status,
        ...(event.status === "completed"
          ? { result: event.output }
          : { error: event.error ?? String(event.output ?? "failed") }),
      });
      break;
    case "interrupt":
      // interrupt 由 stateful-flow run-loop 统一处理，此处不派发。
      break;
    default:
      break;
  }
}
