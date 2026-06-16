/**
 * tools 节点 —— prebuilt ToolNode 执行 tool_calls + onToolCall 三态透出（in_progress → completed/failed）。
 *
 * 工厂在创建时实例化一次 ToolNode；返回的节点函数在执行前后调 callbacks.onToolCall，
 * 让 surface 能展示「工具调用过程」。
 */

import { ToolNode } from "@langchain/langgraph/prebuilt";
import { AIMessage, type ToolMessage } from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import type { FlowState } from "../state.js";
import type { FlowCallbacks } from "../../core/flow-types.js";

export interface ToolsNodeDeps {
  /** 可执行的工具集（与 think 绑定的同一组）。 */
  allTools: StructuredTool[];
  /** surface 回调（透出工具调用事件）。 */
  callbacks?: FlowCallbacks;
}

/** 创建 tools 节点：实例化一次 ToolNode，执行前后透出 onToolCall。 */
export function createToolsNode(deps: ToolsNodeDeps) {
  const { allTools, callbacks } = deps;
  const toolNode = new ToolNode(allTools);

  return async (state: FlowState): Promise<Partial<FlowState>> => {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const calls = (last?.tool_calls ?? []) as Array<{
      id?: string;
      name: string;
      args: Record<string, unknown>;
    }>;
    for (const c of calls) {
      if (callbacks?.onToolCall && c.id) {
        await callbacks.onToolCall({
          toolCallId: c.id,
          toolName: c.name,
          args: c.args,
          status: "in_progress",
        });
      }
    }
    const result = (await toolNode.invoke({ messages: state.messages })) as {
      messages?: ToolMessage[];
    };
    const toolMsgs = result?.messages ?? [];
    for (const tm of toolMsgs) {
      if (callbacks?.onToolCall) {
        const failed = tm.status === "error";
        const text = typeof tm.content === "string" ? tm.content : JSON.stringify(tm.content);
        await callbacks.onToolCall({
          toolCallId: tm.tool_call_id,
          toolName: tm.name ?? "",
          args: {},
          status: failed ? "failed" : "completed",
          ...(failed ? { error: text } : { result: text }),
        });
      }
    }
    return { messages: toolMsgs, steps: toolMsgs.map((t) => `tool:${t.name ?? "?"}`) };
  };
}
