/**
 * 默认 flow 的 executor —— 把默认图包装成 surface 能用的 FlowExecutor。
 *
 * 接收 FlowRuntime（allTools / checkpointer / config / systemPrompt），透传 surface 的
 * onToken / onToolCall 进图。真实模板里把这里换成你自己的图 executor
 * （参考 examples/dev-agent 如何用 StatefulFlow 做多轮 + HITL）。
 */

import type { FlowRuntime } from "../runtime/flow-runtime.js";
import type { FlowExecutor } from "../core/flow-types.js";
import { traceFlowCallbacks, traceFlowRun, isInAcpPromptCycle } from "../runtime/session-trace.js";
import { executeFlow } from "./graph.js";

export function createDefaultExecutor(runtime: FlowRuntime): FlowExecutor {
  return async (query, opts) => {
    const traced = isInAcpPromptCycle() ? (opts ?? {}) : traceFlowCallbacks(opts);
    const run = async () => {
      const { output } = await executeFlow(
        query,
        {
          allTools: runtime.allTools,
          checkpointer: runtime.checkpointer,
          config: runtime.config,
          systemPrompt: runtime.systemPrompt,
        },
        traced
      );
      return { answer: output };
    };
    if (isInAcpPromptCycle()) return run();
    return traceFlowRun("executeFlow", { input: query }, run);
  };
}
