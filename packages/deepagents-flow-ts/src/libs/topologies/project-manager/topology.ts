/**
 * project-manager 拓扑静态反射 —— 不运行图、不需凭证。
 * 节点名：__start__ → plan → estimate → evaluate →(cond) plan|approve → finalize → __end__。
 */
import { createPMGraph } from "./graph.js";
import { reflectTopology } from "../reflect.js";
import type { FlowTopology } from "../../../core/flow-types.js";

export async function getPMTopology(): Promise<FlowTopology> {
  return reflectTopology(createPMGraph());
}
