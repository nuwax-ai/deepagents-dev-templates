/**
 * dispatchSurfaceEvent —— 把归一后的 SurfaceStreamEvent 分发给 FlowCallbacks。
 *
 * stateful-flow 多模式 stream 与 ACP surface 共用，避免两处重复映射逻辑。
 */

import type { FlowCallbacks } from "../core/flow-types.js";
import type { SurfaceStreamEvent } from "./stream-events.js";

/** 将单个 surface 事件分发给 callbacks。 */
export async function dispatchSurfaceEvent(
  event: SurfaceStreamEvent,
  callbacks: FlowCallbacks | undefined
): Promise<void> {
  if (!callbacks) return;

  switch (event.type) {
    case "text": {
      // 全放开：所有节点的流式文本 token 都透出（含 RAG rewrite/grade 等中间决策节点——
      // 有噪声但无害；需要时再收）。messages token 是模型输出文本，不含模型配置（model/api key），
      // 不会泄漏；模型配置泄漏的真实通道是工具结果/错误日志，不经此 token 流。
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
