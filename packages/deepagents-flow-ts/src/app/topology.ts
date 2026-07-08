/**
 * 图拓扑导出 ——【对接「编排可视化」目标】。
 *
 * 把默认 flow 的显式 StateGraph 反射成结构化 `{ nodes, edges }`(+ Mermaid 源),
 * 供 inspector / 文档 / 调试器直接消费:**不运行图、不需要模型凭证**。
 *
 * 映射逻辑复用 libs/topologies/reflect.ts（与各积木 topology 同一实现）。
 *
 * 用法:
 *   import { getFlowTopology } from "./topology.js"; // 工作区内
 *   const { nodes, edges, mermaid } = await getFlowTopology();
 * 或命令行: `pnpm graph`（JSON）/ `pnpm graph --mermaid`；平台安装包为 `nuwax-flow-ts graph`。
 */

import { createFlowGraph, type CreateFlowGraphConfig } from "./graph.js";
import { reflectTopology } from "../libs/topologies/reflect.js";

// 拓扑类型契约下沉 core/flow-types.ts（app + libs/topologies 共享；libs 不能 import app）。
// re-export 维持公开 npm 子路径 `/topology`（见 package.json exports）。
export type { FlowTopology, FlowTopologyNode, FlowTopologyEdge } from "../core/flow-types.js";
import type { FlowTopology } from "../core/flow-types.js";

/**
 * 提取默认 flow 图的拓扑(静态:只构建图结构,不执行节点,无需凭证)。
 * 传入与 createFlowGraph 相同的 config 即可(通常无需 —— 拓扑不依赖 appConfig)。
 */
export async function getFlowTopology(
  config: CreateFlowGraphConfig = {}
): Promise<FlowTopology> {
  return reflectTopology(createFlowGraph(config));
}
