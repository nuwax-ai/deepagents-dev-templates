/**
 * 拓扑反射助手 —— 把任意编译图反射成 FlowTopology（不 invoke、不需凭证）。
 *
 * 镜像 src/app/topology.ts 的 getFlowTopology 映射逻辑；供各 libs/topologies/<name>/topology.ts
 * 复用，避免每个拓扑重复抄一遍 getGraphAsync().reid() → {nodes,edges,mermaid} 的样板。
 */
import type {
  FlowTopology,
  FlowTopologyNode,
  FlowTopologyEdge,
} from "../../core/flow-types.js";

/** 可反射的编译图最小结构（LangGraph `.compile()` 产物的结构子集）。 */
interface ReflectableGraph {
  getGraphAsync(opts?: unknown): Promise<ReflectableGraphViz>;
}
interface ReflectableGraphViz {
  /** reid() 用可读节点名替代内部 id（prepare/think/…，外加 __start__/__end__）。 */
  reid(): ReflectableGraphViz;
  nodes: Record<string, { id: string; name?: string }>;
  edges: Array<{
    source: string;
    target: string;
    conditional?: boolean;
    /** 条件分支标签（路由目标名等）。 */
    data?: string;
  }>;
  drawMermaid(): string;
}

/**
 * 反射编译图拓扑。数据来自 LangGraph `getGraphAsync()`，故拓扑永远与真实连线一致。
 */
export async function reflectTopology(
  compiled: ReflectableGraph
): Promise<FlowTopology> {
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
