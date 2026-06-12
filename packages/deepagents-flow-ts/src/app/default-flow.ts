/**
 * 默认 flow 的 executor —— 把占位图包装成 surface 能用的 FlowExecutor。
 *
 * 真实模板里，把这里换成你自己的图 executor（参考 examples/rag/index.ts
 * 如何用 executeRAG 构造 executor）。
 */

import type { FlowExecutor } from "../surfaces/flow-types.js";
import { executeFlow } from "./graph.js";

export function createDefaultExecutor(): FlowExecutor {
  return async (query, _opts) => {
    const { output } = await executeFlow(query);
    return { answer: output };
  };
}
