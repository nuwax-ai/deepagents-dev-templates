/**
 * 默认 flow 的 executor —— 把默认图包装成 surface 能用的 FlowExecutor。
 *
 * 接收 appConfig(供 LLM 节点 resolveModel);把 surface 传来的 onToken / onToolCall
 * 透传进 executeFlow,使默认流也支持「流式回答」与「工具调用透出」。
 * 真实模板里把这里换成你自己的图 executor(参考 examples/rag/index.ts 如何用 executeRAG)。
 */

import type { AppConfig } from "deepagents-app-ts/runtime";
import type { FlowExecutor } from "../surfaces/flow-types.js";
import { executeFlow } from "./graph.js";

export function createDefaultExecutor(appConfig?: AppConfig): FlowExecutor {
  return async (query, opts) => {
    const { output } = await executeFlow(query, {
      appConfig,
      onToken: opts?.onToken,
      onToolCall: opts?.onToolCall,
    });
    return { answer: output };
  };
}
