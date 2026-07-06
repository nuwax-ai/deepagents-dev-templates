/**
 * dev-agent 拓扑（app 层，stateful-custom）—— 综合 ReAct + 多轮续接 + 上下文压缩。
 *
 * 与其他拓扑不同：dev-agent 复用**默认 ReAct 图**（src/app/graph.ts）+ 手写 run-loop +
 * applyCompaction，**不经 createStatefulFlow**。因依赖 app/graph（默认图），故落 app 层
 * （不能进 libs——libs 不能 import app）。作为 FlowDef 的 `stateful-custom`：createExecutor
 * 直接返回 StatefulFlow，无需组合根 materializeFlow 桥接。
 *
 * 拓扑反射 = 默认图（prepare → think ↔ tools → respond）。
 * 子图（subgraph）需求见 libs/nodes 的 createSubgraphNode（docs/node-kit.md）。
 */
import type { FlowRuntime } from "../../runtime/flow-runtime.js";
import type { StatefulFlow } from "../../core/flow-types.js";
import { createFlowGraph } from "../graph.js";
import { applyCompaction } from "../../libs/compaction.js";
import { getFlowTopology } from "../topology.js";
import type { FlowState } from "../state.js";

/**
 * dev-agent StatefulFlow：复用默认 ReAct 图，多轮用同一 threadId 续接。
 * 每轮重新编译图（绑定本轮 callbacks）；checkpointer 持久化，同 threadId 续接历史。
 * durable stateful flow 上下文压缩：applyCompaction（多轮累积超阈值时摘要 + RemoveMessage 替换历史）。
 */
export function createDevAgentFlow(runtime: FlowRuntime): StatefulFlow {
  return {
    async run(input, threadId, callbacks) {
      // signal 透传：ACP cancel（callbacks.signal）必须进 graph.invoke 才能中止 long-running 执行，
      // 否则用户取消时 dev-agent 仍跑到模型返回（createStatefulFlow 基座已处理，手写 loop 需自补）。
      // callbacks 双轨注入（configurable + createFlowGraph callbacks），与 createStatefulFlow 对齐，
      // 供 write_todos / 工具审批等从 ToolRuntime.configurable 或节点工厂 callbacks 读取。
      const flowCallbacks = {
        onToken: callbacks?.onToken,
        onToolCall: callbacks?.onToolCall,
        onStage: callbacks?.onStage,
        onPlan: callbacks?.onPlan,
        onPermissionRequest: callbacks?.onPermissionRequest,
        onApprovalRequest: callbacks?.onApprovalRequest,
      };
      const config = {
        configurable: {
          thread_id: threadId,
          ...flowCallbacks,
        },
        ...(callbacks?.signal ? { signal: callbacks.signal } : {}),
      };
      const graph = createFlowGraph({
        allTools: runtime.allTools,
        checkpointer: runtime.checkpointer,
        config: runtime.config,
        systemPrompt: runtime.systemPrompt,
        callbacks: flowCallbacks,
      });

      await applyCompaction(graph, config, runtime.config);

      const result = (await graph.invoke(
        { input: input.query ?? "", messages: [] } as unknown as FlowState,
        config
      )) as FlowState;
      return { status: "done", answer: result.output ?? "" };
    },
    // hasStarted：从 checkpointer 推断该 thread 是否已开过题（跨进程/IDE 重启续跑判定）。
    // 不实现则 surface 退回内存跟踪，重启后续跑判定丢失（见 core/flow-types.ts StatefulFlow 注释）。
    async hasStarted(tid) {
      const graph = createFlowGraph({
        allTools: runtime.allTools,
        checkpointer: runtime.checkpointer,
        config: runtime.config,
        systemPrompt: runtime.systemPrompt,
      });
      const snapshot = await graph.getState({
        configurable: { thread_id: tid },
      });
      return (
        Boolean(snapshot.config?.configurable?.checkpoint_id) ||
        (snapshot.next?.length ?? 0) > 0
      );
    },
  };
}

/** dev-agent 复用默认 ReAct 图，拓扑反射同默认图。 */
export function getDevAgentTopology() {
  return getFlowTopology();
}
