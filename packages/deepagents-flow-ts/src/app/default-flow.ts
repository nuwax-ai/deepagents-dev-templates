/**
 * 默认 flow —— 把默认图（src/app/graph.ts 的 LangGraph ReAct）包成 surface 能用的 StatefulFlow recipe。
 *
 * 由组合根 index.ts 的 materializeFlow 调 createStatefulFlow({...recipe, conversational:true,
 * checkpointer, appConfig}) 物化 → 图层 graph.stream 真流式 + 稳定 threadId 多轮记忆
 * （checkpointer）+ 自动压缩。toInput 把 query 给 prepare 节点转 HumanMessage；图状态用标准
 * MessagesAnnotation，同一 threadId 跨轮经 reducer 累积历史。
 *
 * **ACP MCP**：per-session 的 createFlowRuntime 会把 host 下发的 mcpServers 与
 * config/mcp.default.json 合并进 runtime.allTools（native MCP，经 mcp-adapters 加载），本 recipe
 * 经 buildGraph({ allTools: runtime.allTools }) 注入默认 ReAct 图，无需额外接线。
 *
 * 调试 trace 由 surface 层负责（ACP server / CLI），本文件不注入日志。
 */

import type { FlowRuntime } from "../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../core/flow-types.js";
import { createFlowGraph } from "./graph.js";
import type { FlowState } from "./state.js";

/**
 * 默认图的 conversational recipe —— 多轮对话（带记忆 + 流式 + 压缩）。
 * buildGraph 用注入的 checkpointer 编译默认 ReAct 图；toInput 把 query 交给 prepare 节点
 * （转 HumanMessage，经 MessagesAnnotation reducer 追加到 checkpointer 恢复的历史后面）。
 */
export function recipe(runtime: FlowRuntime): StatefulTopologyRecipe {
  return {
    buildGraph: (checkpointer) =>
      createFlowGraph({
        allTools: runtime.allTools,
        checkpointer,
        config: runtime.config,
        systemPrompt: runtime.systemPrompt,
      }),
    toInput: (query) => ({ input: query }),
    toResult: (values) => ({ answer: String((values as FlowState).output ?? "") }),
  };
}
