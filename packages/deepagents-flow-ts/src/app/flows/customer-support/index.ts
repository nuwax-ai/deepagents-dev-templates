/**
 * customer-support — react-tools 拓扑（scaffold 生成，可手改）
 * 智能客服：多轮答疑 + 按需工具调用
 *
 * 复用默认 ReAct 图（src/app/graph.ts），注入场景系统提示词。
 * 系统提示词优先级：spec.systemPrompt（场景）> runtime.systemPrompt（框架兜底，spec 空时用）。
 */
import { randomUUID } from "node:crypto";
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { FlowExecutor } from "../../../core/flow-types.js";
import type { FlowState } from "../../state.js";
import { createFlowGraph } from "../../graph.js";
import { getFlowTopology } from "../../topology.js";

/** 场景系统提示词（spec.systemPrompt）；spec 空时回退 runtime.systemPrompt（框架）。 */
const FALLBACK_SYSTEM_PROMPT = "你是智能客服助手，专注准确、礼貌地解答用户问题。\n\n## 核心能力\n- 理解用户意图，必要时调用工具或检索知识库查询\n- 不确定时如实告知，绝不编造\n\n## 输出规范\n- 先给结论，再给依据；语气简洁友好\n\n## 兜底\n- 信息不足时主动追问；超出范围时引导转人工";

export function createExecutor(runtime: FlowRuntime): FlowExecutor {
  return async (query, callbacks) => {
    const graph = createFlowGraph({
      allTools: runtime.allTools,
      checkpointer: runtime.checkpointer,
      config: runtime.config,
      systemPrompt: FALLBACK_SYSTEM_PROMPT || runtime.systemPrompt,
      callbacks,
    });
    const result = (await graph.invoke(
      { input: query, messages: [] } as unknown as FlowState,
      { configurable: { thread_id: randomUUID() } }
    )) as FlowState;
    return { answer: result.output ?? "" };
  };
}

export function getTopology() {
  return getFlowTopology();
}
