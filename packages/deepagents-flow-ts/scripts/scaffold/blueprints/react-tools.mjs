/**
 * blueprint: react-tools —— 标准 ReAct（prepare → think ↔ tools → respond）。
 *
 * 适合：智能客服、任务/工具型 agent。**复用默认图** src/app/graph.ts 的 createFlowGraph，
 * 只注入场景系统提示词——产出代码极薄、出错面最小，是验证生成管线的基准拓扑。
 *
 * conversational：生成 recipe（由 materializeFlow 物化成 createStatefulFlow，conversational:true）
 * → 图层 graph.stream 真流式 + 稳定 threadId 多轮记忆（checkpointer）+ 自动压缩。
 *
 * 系统提示词优先级：spec.systemPrompt（场景提示词）> runtime.systemPrompt（框架兜底，spec 空时用）。
 * 场景节点用 scene 提示词；runtime.systemPrompt（= resolveSystemPrompt，恒非空）不覆盖 scene，
 * 否则 spec.systemPrompt 永不生效（resolveSystemPrompt 有 inline 兜底恒返回非空）。
 *
 * 工具：think 节点绑定 runtime.allTools 全量；spec.tools 经 platformToolRefs 由 runtime
 * 基于 schema 动态建平台工具后注入 allTools（schema-driven runtime）。
 */

/** 拓扑 kind：复用默认 ReAct 图，conversational stateful-recipe（多轮记忆）。 */
export const kind = "stateful-recipe";
export const conversational = true;

/** @param {{name:string,description:string,systemPrompt:string,tools?:object[]}} spec */
export function render(spec) {
  const fallback = spec.systemPrompt ? JSON.stringify(spec.systemPrompt) : "undefined";
  const platformToolRefs = (spec.tools ?? []).filter(
    (tool) => tool && typeof tool === "object" && "targetType" in tool && "targetId" in tool
  );
  const content = `/**
 * ${spec.name} — react-tools 拓扑（scaffold 生成，可手改）
 * ${spec.description || "标准 ReAct：prepare → think ↔ tools → respond"}
 *
 * 复用默认 ReAct 图（src/app/graph.ts），注入场景系统提示词。
 * conversational recipe：稳定 threadId + checkpointer → 多轮记忆 + 图层 graph.stream 流式 + 自动压缩。
 * 系统提示词优先级：spec.systemPrompt（场景）> runtime.systemPrompt（框架兜底，spec 空时用）。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../../../libs/topologies/types.js";
import type { FlowState } from "../../state.js";
import { createFlowGraph } from "../../graph.js";
import { getFlowTopology } from "../../topology.js";

/** 场景系统提示词（spec.systemPrompt）；spec 空时回退 runtime.systemPrompt（框架）。 */
const FALLBACK_SYSTEM_PROMPT = ${fallback};

/** spec.tools 声明的平台工具引用（开发期 get-config 拉取固化）；runtime 据此动态建工具注入 allTools。 */
const _platformToolRefsJson = ${JSON.stringify(JSON.stringify(platformToolRefs))};
export const platformToolRefs = JSON.parse(_platformToolRefsJson);

export function recipe(runtime: FlowRuntime): StatefulTopologyRecipe {
  return {
    buildGraph: (checkpointer) =>
      createFlowGraph({
        allTools: runtime.allTools,
        checkpointer,
        config: runtime.config,
        systemPrompt: FALLBACK_SYSTEM_PROMPT || runtime.systemPrompt,
      }),
    toInput: (query) => ({ input: query }),
    toResult: (values) => ({ answer: String((values as FlowState).output ?? "") }),
  };
}

export function getTopology() {
  return getFlowTopology();
}
`;
  return [{ path: `src/app/flows/${spec.name}/index.ts`, content }];
}
