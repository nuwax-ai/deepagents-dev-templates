/**
 * Flow 注册表 —— 选图入口（app 层）。
 *
 * 产品工作区仅保留默认 ReAct（default）；图逻辑在 `graph.ts` / `default-flow.ts`。
 * 多轮 chat、检索增强等场景请直接改默认图或对照 `docs/` 自建，勿依赖内置 demo 选图。
 *
 * 选图：配置 `flow.active`（缺省 "default"）。
 * 组合根 index.ts 按 `resolveFlowSelection(raw)` + `resolveFlow(...)` 取 executor / topology。
 */

import type { FlowRuntime } from "../../runtime/flow-runtime.js";
import type {
  FlowInteractionKind,
  FlowProfile,
  StatefulTopologyRecipe,
} from "../../core/flow-types.js";
import { recipe as defaultRecipe } from "../default-flow.js";
import { getFlowTopology, type FlowTopology } from "../topology.js";
import { logger } from "../../runtime/index.js";
import type { PlatformToolRef } from "../../runtime/platform-tools/types.js";

/**
 * 可挂载到 surface 的 flow 定义。
 * createStatefulFlow 的实际调用由组合根 index.ts 的 materializeFlow 完成。
 */
export type FlowDef = {
  name: string;
  kind: "stateful-recipe";
  profile: FlowProfile;
  recipe: (runtime: FlowRuntime) => StatefulTopologyRecipe;
  /**
   * 对话型（多轮对话）。物化时：显式 `conversational` 优先；未设则
   * `profile.interaction === "chat"` → `createStatefulFlow({ conversational: true })`
   * （不暴露 hasStarted，surface 每轮 query + 稳定 threadId 累积历史）。
   */
  conversational?: boolean;
  /**
   * 平台工具引用。平台已登记工具的真实 schema 固化于此；
   * 经 `createFlowRuntime` → `allTools`。**不是**旧 `spec.tools` / flow.json。
   */
  platformToolRefs?: PlatformToolRef[];
  getTopology: () => Promise<FlowTopology>;
};

export interface FlowSelection {
  active: string;
  source: "flow.active" | "activeFlow" | "default";
  defaultInteraction: FlowInteractionKind;
  unknownActivePolicy: "warn-default" | "default";
}

function normalizeInteraction(value: unknown): FlowInteractionKind {
  return value === "pipeline" || value === "approval" ? value : "chat";
}

function normalizeUnknownPolicy(value: unknown): "warn-default" | "default" {
  return value === "default" ? "default" : "warn-default";
}

/** 从 flow 配置解析 active flow，同时兼容旧顶层 activeFlow。 */
export function resolveFlowSelection(raw: Record<string, unknown> = {}): FlowSelection {
  const flow = raw.flow && typeof raw.flow === "object" ? raw.flow as Record<string, unknown> : {};
  const activeFromFlow = typeof flow.active === "string" && flow.active.trim() ? flow.active.trim() : undefined;
  const activeFromLegacy = typeof raw.activeFlow === "string" && raw.activeFlow.trim()
    ? raw.activeFlow.trim()
    : undefined;
  if (activeFromFlow && activeFromLegacy) {
    logger.warn(`flow.active="${activeFromFlow}" 优先于旧 activeFlow="${activeFromLegacy}"；请迁移到 flow.active。`);
  }
  return {
    active: activeFromFlow ?? activeFromLegacy ?? "default",
    source: activeFromFlow ? "flow.active" : activeFromLegacy ? "activeFlow" : "default",
    defaultInteraction: normalizeInteraction(flow.defaultInteraction),
    unknownActivePolicy: normalizeUnknownPolicy(flow.unknownActivePolicy),
  };
}

/** 内置 flow 注册表：仅 default。 */
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
};

/** 按名取 flow，未命中或未指定回落到 default。 */
export function resolveFlow(name?: string, opts: { unknownActivePolicy?: "warn-default" | "default" } = {}): FlowDef {
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
    conversational: def.conversational ?? def.profile.interaction === "chat",
  }));
}

export function recommendFlows(kind: FlowInteractionKind) {
  return listFlowProfiles()
    .filter((flow) => flow.profile.interaction === kind)
    .sort((a, b) => Number(Boolean(b.profile.defaultForAmbiguous)) - Number(Boolean(a.profile.defaultForAmbiguous)));
}
