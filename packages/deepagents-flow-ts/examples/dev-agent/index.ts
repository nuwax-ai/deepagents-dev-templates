#!/usr/bin/env tsx
/**
 * dev-agent —— 综合能力示例。
 *
 * 把模板的全部能力串成一个可跑的 Agent：
 *  - 标准 LangGraph ReAct（prepare → think ↔ tools → respond），think 用 bindTools
 *  - 真实工具：bash / 文件读写 / search / http / context7 MCP（经 FlowRuntime.allTools）
 *  - 会话持久化：FileCheckpointSaver，多轮用同一 threadId → 跨重启续接历史
 *  - 上下文压缩：src/app/compaction.ts（单测覆盖）；图内写回需 RemoveMessage 替换模式
 *  - Subagent：researcher subgraph（见 ./researcher.ts），框架原生 subgraph 模式
 *
 * 用法：
 *   pnpm example:dev-agent "帮我查 langgraph 的 ToolNode 用法并写个最小示例"
 *   pnpm example:dev-agent -i          # 交互（多轮续接）
 *
 * 无模型凭证 → 默认图走 fallback（回显输入），仍可验证图闭环。
 * 真实工具调用需配 ANTHROPIC_API_KEY（或 OPENAI_API_KEY）。
 */

import { loadFlowConfig } from "../../src/runtime/config.js";
import { createFlowRuntime, type FlowRuntime } from "../../src/runtime/flow-runtime.js";
import { createFlowGraph } from "../../src/app/graph.js";
import { runFlowCli } from "../../src/surfaces/cli/run.js";
import type { FlowState } from "../../src/app/state.js";
import type { StatefulFlow } from "../../src/surfaces/flow-types.js";

/**
 * dev-agent StatefulFlow：复用默认 ReAct 图，多轮用同一 threadId 续接。
 * 上下文压缩在 src/app/compaction.ts 实现（图内写回用 RemoveMessage 替换模式，见 docs/flow-patterns.md）。
 */
export function createDevAgentFlow(runtime: FlowRuntime): StatefulFlow {
  return {
    async run(input, threadId, callbacks) {
      const config = { configurable: { thread_id: threadId } };
      // 每轮重新编译图（绑定本轮 callbacks）；checkpointer 持久化，同 threadId 续接历史
      const graph = createFlowGraph({
        allTools: runtime.allTools,
        checkpointer: runtime.checkpointer,
        config: runtime.config,
        systemPrompt: runtime.systemPrompt,
        callbacks: { onToken: callbacks?.onToken, onToolCall: callbacks?.onToolCall },
      });

      const result = (await graph.invoke(
        { input: input.query ?? "", messages: [] } as unknown as FlowState,
        config
      )) as FlowState;
      return { status: "done", answer: result.output ?? "" };
    },
  };
}

async function main(): Promise<void> {
  const { appConfig } = loadFlowConfig();
  const runtime = await createFlowRuntime(appConfig);
  const flow = createDevAgentFlow(runtime);
  const query = process.argv[2];
  await runFlowCli(flow, { query, interactive: !query });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
