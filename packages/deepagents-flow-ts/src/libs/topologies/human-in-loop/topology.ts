/**
 * human-in-loop 拓扑静态反射 —— 不运行图、不需凭证，供 `graph` 命令 / inspector 消费。
 * 节点名：__start__ → compose → review → finalize → __end__。
 */
import { createReviewGraph } from "./graph.js";
import { reflectTopology } from "../reflect.js";
import type { FlowTopology } from "../../../core/flow-types.js";

/** 提取 human-in-loop 图拓扑（最小配置建图，仅反射结构）。 */
export async function getReviewTopology(): Promise<FlowTopology> {
  return reflectTopology(createReviewGraph());
}
