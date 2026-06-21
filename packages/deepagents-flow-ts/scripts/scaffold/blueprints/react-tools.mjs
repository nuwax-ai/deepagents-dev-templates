/**
 * blueprint: react-tools —— 标准 ReAct（prepare → think ↔ tools → respond）。
 *
 * 适合：智能客服、任务/工具型 agent。**复用默认图** src/app/graph.ts 的 createFlowGraph，
 * 只注入场景系统提示词——产出代码极薄、出错面最小，是验证生成管线的基准拓扑。
 *
 * 系统提示词优先级：spec.systemPrompt（场景提示词）> runtime.systemPrompt（框架兜底，spec 空时用）。
 * 场景节点用 scene 提示词；runtime.systemPrompt（= resolveSystemPrompt，恒非空）不覆盖 scene，
 * 否则 spec.systemPrompt 永不生效（resolveSystemPrompt 有 inline 兜底恒返回非空）。
 */

/** 拓扑 kind（FlowDef discriminated union 的判别字段）。react-tools 复用默认 ReAct 图，one-shot。 */
export const kind = "oneshot";

/** @param {{name:string,description:string,systemPrompt:string}} spec */
export function render(spec) {
  const fallback = spec.systemPrompt ? JSON.stringify(spec.systemPrompt) : "undefined";
  const content = `/**
 * ${spec.name} — react-tools 拓扑（scaffold 生成，可手改）
 * ${spec.description || "标准 ReAct：prepare → think ↔ tools → respond"}
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
const FALLBACK_SYSTEM_PROMPT = ${fallback};

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
`;
  return [{ path: `src/app/flows/${spec.name}/index.ts`, content }];
}
