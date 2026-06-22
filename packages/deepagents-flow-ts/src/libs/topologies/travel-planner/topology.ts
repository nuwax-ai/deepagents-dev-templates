/**
 * travel-planner 拓扑静态反射 —— 不运行图、不需凭证。
 * 节点名：__start__ → gather →(Send 扇出) research → aggregate → confirm → finalize → __end__。
 */
import { createTravelGraph } from "./graph.js";
import { reflectTopology } from "../reflect.js";
import type { FlowTopology } from "../../../core/flow-types.js";

export async function getTravelTopology(): Promise<FlowTopology> {
  return reflectTopology(createTravelGraph());
}
