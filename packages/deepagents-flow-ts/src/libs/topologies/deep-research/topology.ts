/**
 * deep-research 拓扑静态反射 —— 不运行图、不需凭证。
 * 节点名：__start__ → clarify → plan → outline_gate →(Send) research → review → draft → converse ↔ respond → delivery → __end__。
 */
import { createResearchGraph } from "./graph.js";
import { reflectTopology } from "../reflect.js";
import type { FlowTopology } from "../../../core/flow-types.js";

export async function getResearchTopology(): Promise<FlowTopology> {
  return reflectTopology(createResearchGraph());
}
