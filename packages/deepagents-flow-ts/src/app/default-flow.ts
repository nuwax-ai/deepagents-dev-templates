/**
 * 默认 flow —— 把默认图（src/app/graph.ts 的 LangGraph ReAct）包成 surface 能用的形态。
 *
 * 两个导出：
 *  - `recipe`（**默认注册走这个**）：conversational stateful-recipe 的「图配方」。由组合根
 *    index.ts 的 materializeFlow 调 createStatefulFlow({...recipe, conversational:true,
 *    checkpointer, appConfig}) 物化 → 图层 graph.stream 真流式 + 稳定 threadId 多轮记忆
 *    （checkpointer）+ 自动压缩。toInput 把 query 给 prepare 节点转 HumanMessage；图状态用标准
 *    MessagesAnnotation，同一 threadId 跨轮经 reducer 累积历史。
 *    **ACP MCP**：per-session 的 createFlowRuntime 会把 host 下发的 mcpServers 与
 *    config/mcp.default.json 合并进 runtime.allTools（native MCP + mcp_tool_bridge），本 recipe
 *    经 buildGraph({ allTools: runtime.allTools }) 注入默认 ReAct 图，无需额外接线。
 *  - `createDefaultExecutor`（保留）：one-shot FlowExecutor（每次新 thread、无记忆），供
 *    flow.test.ts / 不需要会话记忆的单次调用。请求路径默认不再用它。
 *
 * 调试 trace 由 surface 层负责（ACP server / CLI），本文件不注入日志。
 */

import type { FlowRuntime } from "../runtime/flow-runtime.js";
import type { FlowExecutor } from "../core/flow-types.js";
import type { StatefulTopologyRecipe } from "../libs/topologies/types.js";
import { createFlowGraph, executeFlow } from "./graph.js";
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

/** one-shot 执行器（每次新 thread、无记忆）；保留供测试 / 无需会话记忆的单次调用。 */
export function createDefaultExecutor(runtime: FlowRuntime): FlowExecutor {
  return async (query, opts) => {
    const { output } = await executeFlow(
      query,
      {
        allTools: runtime.allTools,
        checkpointer: runtime.checkpointer,
        config: runtime.config,
        systemPrompt: runtime.systemPrompt,
      },
      opts
    );
    return { answer: output };
  };
}
