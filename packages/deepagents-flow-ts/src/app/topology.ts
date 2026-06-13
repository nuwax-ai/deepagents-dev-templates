/**
 * 图拓扑导出 ——【对接「编排可视化」目标】。
 *
 * 把默认 flow 的显式 StateGraph 反射成结构化 `{ nodes, edges }`(+ Mermaid 源),
 * 供 inspector / 文档 / 调试器直接消费:**不运行图、不需要模型凭证**。
 *
 * 数据来自 LangGraph 编译图的 `getGraphAsync()`(新版推荐入口,`getGraph()` 已 deprecated),
 * 所以拓扑永远与 graph.ts 的真实连线一致 —— 绝不与手抄的节点列表漂移。
 *
 * 用法:
 *   import { getFlowTopology } from "deepagents-flow-ts/topology";
 *   const { nodes, edges, mermaid } = await getFlowTopology();
 * 或命令行:`deepagents-flow-ts graph`(JSON) / `deepagents-flow-ts graph --mermaid`。
 */

import { createFlowGraph, type CreateFlowGraphConfig } from "./graph.js";

export interface FlowTopologyNode {
  id: string;
  label: string;
}

export interface FlowTopologyEdge {
  source: string;
  target: string;
  /** 条件边(addConditionalEdges)为 true,普通边为 false。 */
  conditional: boolean;
  /** 条件分支标签(如路由目标名);普通边无标签。 */
  label?: string;
}

export interface FlowTopology {
  nodes: FlowTopologyNode[];
  edges: FlowTopologyEdge[];
  /** 同一拓扑的 Mermaid 源,可直接渲染 / 贴进文档。 */
  mermaid: string;
}

/**
 * 提取默认 flow 图的拓扑(静态:只构建图结构,不执行节点,无需凭证)。
 * 传入与 createFlowGraph 相同的 config 即可(通常无需 —— 拓扑不依赖 appConfig)。
 */
export async function getFlowTopology(
  config: CreateFlowGraphConfig = {}
): Promise<FlowTopology> {
  const compiled = createFlowGraph(config);
  // reid(): 用可读节点名替代内部 id(prepare/think/…,外加 __start__/__end__)。
  const g = (await compiled.getGraphAsync({})).reid();

  const nodes: FlowTopologyNode[] = Object.values(g.nodes).map((n) => ({
    id: n.id,
    label: n.name || n.id,
  }));
  const edges: FlowTopologyEdge[] = g.edges.map((e) => ({
    source: e.source,
    target: e.target,
    conditional: e.conditional ?? false,
    ...(e.data ? { label: e.data } : {}),
  }));

  return { nodes, edges, mermaid: g.drawMermaid() };
}
