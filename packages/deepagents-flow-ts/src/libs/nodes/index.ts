/**
 * src/libs/nodes —— 可复用 LangGraph 节点 factory 目录（「现成节点」菜单）。
 *
 * 与 src/app/nodes 平级区分：app/nodes 放**默认图专属节点定义**（think/respond 等），
 * 本目录放**跨图复用的 factory + 支撑原语**，默认图与示例共享、可选不用。
 *
 * 主导出（factory）：
 *  - llm：createLlmNode（一次调→文本/结构化）、createLlmStreamNode（流式）
 *  - tools：createToolExecNode（ToolNode + 三态透出）
 *  - hitl：createHumanApprovalNode（interrupt + isApproval）
 *  - prepare：createPrepareNode（input → HumanMessage）
 *
 * 支撑原语（factory 内部用，过渡期示例也可 import）：emit* / runTool / extractText /
 * parseJson / streamLLMText / isApproval。韧性原语在 runtime/services/llm-resilience，
 * checkpointer 选择（durableCheckpointer）在 runtime/services/file-checkpoint-saver。
 */

export { emitStage, emitPlan, emitTextToken } from "./emit.js";
export { createPrepareNode, type PrepareNodeOptions } from "./prepare.js";
export {
  createHumanApprovalNode,
  isApproval,
  type HumanApprovalNodeOptions,
} from "./hitl.js";
export { createToolExecNode, runTool, type ToolExecNodeOptions } from "./tools.js";
export {
  createLlmNode,
  createLlmStreamNode,
  extractText,
  parseJson,
  streamLLMText,
  type LlmNodeOptions,
  type LlmStreamNodeOptions,
  type LLMLike,
  type ChatModelLike,
  type StreamLlmTextOptions,
} from "./llm.js";
export { createFanout, type FanoutOptions } from "./fanout.js";
export { createSubgraphNode, type SubgraphNodeOptions } from "./subgraph.js";

/**
 * 路由(router)模式 —— 不单独建 factory,因 LangGraph 原生已覆盖:
 *  - HITL 门禁路由(人审 → 通过/打回):用 `createHumanApprovalNode({ ..., route })`(返回 Command)。
 *  - 规则条件边(`toolsCondition` / `routeAfterGrade` 等):就是普通 `(state) => nodeName` 函数,无需封装。
 *  - LLM 裁决路由(reflection/evaluator):评估节点用 `createLlmNode({ parse })` 写 decision,
 *    配一个纯条件边函数 `(state) => redo | done`(参见 examples 的 routeAfterXxx,可单测)。
 */
