/**
 * trip-planner — travel-planner 拓扑（scaffold 生成，可手改）
 * 旅行规划：并行搜索交通/住宿/景点/美食 → 整理成行程 → 人审确认（stateful）
 *
 * 图逻辑单一权威在 src/libs/topologies/travel-planner/；本文件只绑 spec。
 * systemPrompt 注入 aggregate 节点角色开场。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../../../libs/topologies/types.js";
import { travelRecipe, getTravelTopology } from "../../../libs/topologies/travel-planner/index.js";

const FALLBACK_SYSTEM_PROMPT = "你是经验丰富的旅行规划师，擅长把多源搜索结果整合成按天、可执行、预算友好的行程。";

// as StatefulTopologyRecipe：边界处擦除具体 state 泛型。
export const recipe = (runtime: FlowRuntime): StatefulTopologyRecipe =>
  travelRecipe(runtime, {
    systemPrompt: FALLBACK_SYSTEM_PROMPT,
  }) as StatefulTopologyRecipe;

export const getTopology = () => getTravelTopology();
