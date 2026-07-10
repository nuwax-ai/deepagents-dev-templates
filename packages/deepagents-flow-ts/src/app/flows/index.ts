/**
 * Flow 注册表 —— 多 flow 选图入口（app 层）。
 *
 * 默认图（default）纳入注册表但**不移动**其文件（graph.ts / default-flow.ts / topology.ts 原位）。
 * scaffold 生成的场景 flow 落在 `src/app/flows/<name>/`，并在下方 `flows` 表注册一行
 * —— generator 在 SCAFFOLD-REGISTRY 标记区自动插入 import + 表项，勿手动打乱标记。
 *
 * 内置示例（各代表一类形态）：
 *  - default          conversational ReAct 泛化底座（多数聊天助手型需求 = default + 平台能力 + systemPrompt）
 *  - dev-agent        stateful-custom：默认 ReAct + 手写 run-loop + 上下文压缩（本目录内置，非 scaffold）
 *  - search-aggregator conversational + 平台能力样板（复用默认图，演示「登记即接入」，见其 index.ts）
 *  - translate-review  one-shot 流式管道教学（custom 拓扑）
 *  - router-gate       LLM 路由教学（custom 拓扑）
 * 更多形态见 `src/libs/topologies/`（积木）；场景 spec 范例在 `scripts/scaffold/specs/`。
 *
 * 选图：配置 `flow.active`（缺省 "default"）。
 * 组合根 index.ts 按 `resolveFlowSelection(raw)` + `resolveFlow(...)` 取 executor / topology。
 */

import type { FlowRuntime } from "../../runtime/flow-runtime.js";
import type {
  FlowInteractionKind,
  FlowProfile,
  StatefulFlow,
} from "../../core/flow-types.js";
import { recipe as defaultRecipe } from "../default-flow.js";
import { getFlowTopology, type FlowTopology } from "../topology.js";
import * as devAgentFlow from "./dev-agent/index.js";
import * as routerGateFlow from "./router-gate/index.js";
import * as searchAggregatorFlow from "./search-aggregator/index.js";
import * as translateReviewFlow from "./translate-review/index.js";
import { logger } from "../../runtime/index.js";
import type { StatefulTopologyRecipe } from "../../libs/topologies/types.js";
import type { PlatformToolRef } from "../../runtime/platform-tools/types.js";

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
      profile: FlowProfile;
      recipe: (runtime: FlowRuntime) => StatefulTopologyRecipe;
      /**
       * 对话型（多轮对话，非 HITL）。物化时透传 createStatefulFlow → 不暴露 hasStarted，
       * surface 每轮走 query + 稳定 threadId 累积历史（见 surfaces/stateful-flow.ts）。
       */
      conversational?: boolean;
      platformToolRefs?: PlatformToolRef[];
      getTopology: () => Promise<FlowTopology>;
    }
  | {
      name: string;
      kind: "stateful-custom";
      profile: FlowProfile;
      createExecutor: (runtime: FlowRuntime) => StatefulFlow;
      platformToolRefs?: PlatformToolRef[];
      getTopology: () => Promise<FlowTopology>;
    };

export interface FlowSelection {
  active: string;
  source: "flow.active" | "default";
  defaultInteraction: FlowInteractionKind;
  unknownActivePolicy: "warn-default" | "default";
}

function normalizeInteraction(value: unknown): FlowInteractionKind {
  return value === "pipeline" || value === "approval" ? value : "chat";
}

function normalizeUnknownPolicy(value: unknown): "warn-default" | "default" {
  return value === "default" ? "default" : "warn-default";
}

/** 从 flow 配置解析 active flow。 */
export function resolveFlowSelection(raw: Record<string, unknown> = {}): FlowSelection {
  const flow = raw.flow && typeof raw.flow === "object" ? raw.flow as Record<string, unknown> : {};
  const activeFromFlow = typeof flow.active === "string" && flow.active.trim() ? flow.active.trim() : undefined;
  return {
    active: activeFromFlow ?? "default",
    source: activeFromFlow ? "flow.active" : "default",
    defaultInteraction: normalizeInteraction(flow.defaultInteraction),
    unknownActivePolicy: normalizeUnknownPolicy(flow.unknownActivePolicy),
  };
}

export const flows: Record<string, FlowDef> = {
  default: {
    name: "default",
    kind: "stateful-recipe",
    profile: {
      interaction: "chat",
      implementation: "default",
      userLabel: "聊天助手型",
      summary: "可连续追问、按需调工具，适合客服、问答、搜索总结和通用助手。",
      defaultForAmbiguous: true,
    },
    conversational: true,
    recipe: defaultRecipe,
    getTopology: () => getFlowTopology(),
  },
  // 内置 stateful-custom（非 scaffold 生成，放在 SCAFFOLD-REGISTRY 之外）
  "dev-agent": {
    name: "dev-agent",
    kind: "stateful-custom",
    profile: {
      interaction: "chat",
      implementation: "custom",
      userLabel: "聊天助手型",
      summary: "开发 Agent 样板：ReAct、多轮续接和上下文压缩。",
      defaultForAmbiguous: true,
    },
    createExecutor: (runtime) => devAgentFlow.createDevAgentFlow(runtime),
    getTopology: () => devAgentFlow.getDevAgentTopology(),
  },
  // --- SCAFFOLD-REGISTRY-START (generator 自动维护，勿手改此区) ---
  "router-gate": {
    name: "router-gate",
    kind: "stateful-recipe",
    profile: { interaction: "pipeline", implementation: "custom", userLabel: "固定流程型", summary: "LLM 路由教学：按固定裁决门通过或重做。", requiresGraphReason: true },
    recipe: routerGateFlow.recipe,
    platformToolRefs: (routerGateFlow as { platformToolRefs?: PlatformToolRef[] }).platformToolRefs,
    getTopology: routerGateFlow.getTopology,
  },
  "search-aggregator": {
    name: "search-aggregator",
    kind: "stateful-recipe",
    profile: { interaction: "chat", implementation: "preset", userLabel: "聊天助手型", summary: "平台能力对话样板：default 底座 + 搜索聚合提示词。", defaultForAmbiguous: true },
    conversational: true,
    recipe: searchAggregatorFlow.recipe,
    platformToolRefs: (searchAggregatorFlow as { platformToolRefs?: PlatformToolRef[] }).platformToolRefs,
    getTopology: searchAggregatorFlow.getTopology,
  },
  "translate-review": {
    name: "translate-review",
    kind: "stateful-recipe",
    profile: { interaction: "approval", implementation: "custom", userLabel: "人工确认型", summary: "翻译草稿后进入人工审阅，再按意见定稿。", requiresGraphReason: true },
    recipe: translateReviewFlow.recipe,
    platformToolRefs: (translateReviewFlow as { platformToolRefs?: PlatformToolRef[] }).platformToolRefs,
    getTopology: translateReviewFlow.getTopology,
  },
  // --- SCAFFOLD-REGISTRY-END ---
};

/** 按名取 flow，未命中或未指定回落到 default。 */
export function resolveFlow(name?: string, opts: { unknownActivePolicy?: "warn-default" | "default" } = {}): FlowDef {
  // 未知 active flow（拼错 / 大小写错）不静默回落 default —— 告警，否则用户以为切到了某拓扑，
  // 实际跑的是默认 ReAct，难以排查。仍回落 default（不中断），但留下可追踪的 warn。
  if (name && !flows[name] && opts.unknownActivePolicy !== "default") {
    logger.warn(
      `active flow "${name}" 未在 flow 注册表，回落 default。已注册: ${Object.keys(flows).join(", ")}`
    );
  }
  return (name ? flows[name] : undefined) ?? flows.default!;
}

export function listFlowProfiles() {
  return Object.values(flows).map((def) => ({
    name: def.name,
    kind: def.kind,
    profile: def.profile,
    isDefault: def.name === "default",
    conversational: def.profile.interaction === "chat",
  }));
}

export function recommendFlows(kind: FlowInteractionKind) {
  return listFlowProfiles()
    .filter((flow) => flow.profile.interaction === kind)
    .sort((a, b) => Number(Boolean(b.profile.defaultForAmbiguous)) - Number(Boolean(a.profile.defaultForAmbiguous)));
}
