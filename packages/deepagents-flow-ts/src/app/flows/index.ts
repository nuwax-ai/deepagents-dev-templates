/**
 * Flow 注册表 —— 多 flow 选图入口（app 层）。
 *
 * 默认图（default）纳入注册表但**不移动**其文件（graph.ts / default-flow.ts / topology.ts 原位）。
 * scaffold 生成的场景 flow 落在 `src/app/flows/<name>/`，并在下方 `flows` 表注册一行
 * —— generator 在 SCAFFOLD-REGISTRY 标记区自动插入 import + 表项，勿手动打乱标记。
 *
 * 选图：config 顶层自定义键 `activeFlow`（经 loadFlowConfig 的 `raw` 读取，缺省 "default"，
 * 机制同 examples 读 `raw.rag`）。组合根 index.ts 按 `resolveFlow(activeFlow)` 取 executor / topology。
 * 不改 runtime 的 AppConfig schema（保护区），零侵入。
 */

import type { FlowRuntime } from "../../runtime/flow-runtime.js";
import type { StatefulFlow } from "../../core/flow-types.js";
import { recipe as defaultRecipe } from "../default-flow.js";
import { getFlowTopology, type FlowTopology } from "../topology.js";
import * as routerGateFlow from "./router-gate/index.js";
import * as gradeRedoFlow from "./grade-redo/index.js";
import * as multiAspectSearchFlow from "./multi-aspect-search/index.js";
import * as translateReviewFlow from "./translate-review/index.js";
import { logger } from "../../runtime/index.js";
import * as codingAgentFlow from "./coding-agent/index.js";
import * as researchAgentFlow from "./research-agent/index.js";
import * as knowledgeQaFlow from "./knowledge-qa/index.js";
import * as adaptiveKnowledgeQaFlow from "./adaptive-knowledge-qa/index.js";
import * as tripPlannerFlow from "./trip-planner/index.js";
import * as projectPlannerFlow from "./project-planner/index.js";
import * as contentReviewFlow from "./content-review/index.js";
import * as customerSupportFlow from "./customer-support/index.js";
import type { StatefulTopologyRecipe } from "../../libs/topologies/types.js";

/**
 * 一个可挂载到 surface 的 flow 定义（discriminated union on `kind`）。
 *
 * 两类：
 *  - `stateful-recipe`：拓扑只给「图构造配方」recipe；recipe 零 surface 依赖、可存 app 层；
 *    createStatefulFlow 的实际调用由组合根 index.ts（root，能 import surfaces）的 materializeFlow 完成
 *    ——规避 app/libs → surfaces 分层违规。
 *  - `stateful-custom`：自定义 StatefulFlow（如 dev-agent，依赖 app/graph），createExecutor 留 app 层。
 *
 * getTopology 静态导出图拓扑（不运行图、不需凭证），供 `graph` 命令 / inspector 消费。
 */
export type FlowDef =
  | {
      name: string;
      kind: "stateful-recipe";
      recipe: (runtime: FlowRuntime) => StatefulTopologyRecipe;
      /**
       * 对话型（多轮对话，非 HITL）。物化时透传 createStatefulFlow → 不暴露 hasStarted，
       * surface 每轮走 query + 稳定 threadId 累积历史（见 surfaces/stateful-flow.ts）。
       */
      conversational?: boolean;
      getTopology: () => Promise<FlowTopology>;
    }
  | {
      name: string;
      kind: "stateful-custom";
      createExecutor: (runtime: FlowRuntime) => StatefulFlow;
      getTopology: () => Promise<FlowTopology>;
    };

export const flows: Record<string, FlowDef> = {
  default: {
    name: "default",
    kind: "stateful-recipe",
    conversational: true,
    recipe: defaultRecipe,
    getTopology: () => getFlowTopology(),
  },
  // --- SCAFFOLD-REGISTRY-START (generator 自动维护，勿手改此区) ---
  "router-gate": { name: "router-gate", kind: "stateful-recipe", recipe: routerGateFlow.recipe, getTopology: routerGateFlow.getTopology },
  "grade-redo": { name: "grade-redo", kind: "stateful-recipe", recipe: gradeRedoFlow.recipe, getTopology: gradeRedoFlow.getTopology },
  "multi-aspect-search": { name: "multi-aspect-search", kind: "stateful-recipe", recipe: multiAspectSearchFlow.recipe, getTopology: multiAspectSearchFlow.getTopology },
  "translate-review": { name: "translate-review", kind: "stateful-recipe", recipe: translateReviewFlow.recipe, getTopology: translateReviewFlow.getTopology },
  "coding-agent": { name: "coding-agent", kind: "stateful-custom", createExecutor: codingAgentFlow.createExecutor, getTopology: codingAgentFlow.getTopology },
  "research-agent": { name: "research-agent", kind: "stateful-recipe", recipe: researchAgentFlow.recipe, getTopology: researchAgentFlow.getTopology },
  "knowledge-qa": { name: "knowledge-qa", kind: "stateful-recipe", conversational: true, recipe: knowledgeQaFlow.recipe, getTopology: knowledgeQaFlow.getTopology },
  "adaptive-knowledge-qa": { name: "adaptive-knowledge-qa", kind: "stateful-recipe", conversational: true, recipe: adaptiveKnowledgeQaFlow.recipe, getTopology: adaptiveKnowledgeQaFlow.getTopology },
  "trip-planner": { name: "trip-planner", kind: "stateful-recipe", recipe: tripPlannerFlow.recipe, getTopology: tripPlannerFlow.getTopology },
  "project-planner": { name: "project-planner", kind: "stateful-recipe", recipe: projectPlannerFlow.recipe, getTopology: projectPlannerFlow.getTopology },
  "content-review": { name: "content-review", kind: "stateful-recipe", recipe: contentReviewFlow.recipe, getTopology: contentReviewFlow.getTopology },
  "customer-support": { name: "customer-support", kind: "stateful-recipe", conversational: true, recipe: customerSupportFlow.recipe, getTopology: customerSupportFlow.getTopology },
  // --- SCAFFOLD-REGISTRY-END ---
};

/** 按名取 flow，未命中或未指定回落到 default。 */
export function resolveFlow(name?: string): FlowDef {
  // 未知 activeFlow（拼错 / 大小写错）不静默回落 default —— 告警，否则用户以为切到了某拓扑，
  // 实际跑的是默认 ReAct，难以排查。仍回落 default（不中断），但留下可追踪的 warn。
  if (name && !flows[name]) {
    logger.warn(
      `activeFlow "${name}" 未在 flow 注册表，回落 default。已注册: ${Object.keys(flows).join(", ")}`
    );
  }
  return (name ? flows[name] : undefined) ?? flows.default!;
}
