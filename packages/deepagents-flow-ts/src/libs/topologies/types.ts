/**
 * 拓扑 recipe 类型（libs 层，零 surface 依赖）。
 *
 * createStatefulFlow（surfaces 层，src/surfaces/stateful-flow.ts）是有状态长任务的统一基座，
 * 但它钉在 surfaces（依赖 app/compaction + surfaces 事件分发 map-stream-chunk/dispatch-surface-event），
 * libs / app 都 import 不到（分层：只能 import 左侧）。解决：libs 层只描述「图构造配方」(recipe)，
 * 由组合根 index.ts（root，能 import surfaces）调 createStatefulFlow 把 recipe 物化成 StatefulFlow。
 *
 * 本文件重声明 createStatefulFlow 所需的 RunnableGraph 与「图相关」入参子集，签名与 surfaces 版本
 * 逐字对齐（仅类型、不引 surfaces）——保证 recipe 能被 createStatefulFlow 结构化接受。
 */
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";

/** LangGraph 编译图的最小结构（与 src/surfaces/stateful-flow.ts 的 RunnableGraph 逐字对齐）。 */
export interface TopologyRunnableGraph {
  stream(input: unknown, config?: RunnableConfig): Promise<AsyncIterable<unknown>>;
  getState(config: RunnableConfig): Promise<{
    values: unknown;
    next?: readonly string[];
    /** 当前 checkpoint 定位 config —— 有 checkpoint_id ⇒ 该 thread 已开过题。 */
    config?: { configurable?: { checkpoint_id?: string } };
  }>;
  /** 写回状态（自动压缩用）。 */
  updateState(config: RunnableConfig, values: Record<string, unknown>): Promise<unknown>;
}

/**
 * stateful 拓扑的构造配方：createStatefulFlow 的「图相关」入参子集
 * （buildGraph / toInput / toResult / 可选 configurable / recursionLimit）。
 * checkpointer + appConfig 由组合根 materialize 时注入（来自 FlowRuntime）。
 *
 * `recipe(runtime)` 返回本类型；index.ts 的 materializeFlow 调
 * `createStatefulFlow({ ...recipe(runtime), checkpointer: runtime.checkpointer, appConfig: runtime.config })`。
 */
export interface StatefulTopologyRecipe<S = Record<string, unknown>> {
  /** 用注入的 checkpointer 编译图并返回（recipe 闭包 runtime.config，不在此处重编 per-run）。 */
  buildGraph: (checkpointer: BaseCheckpointSaver) => TopologyRunnableGraph;
  /** 新任务：把用户 query 映射成图初始 state。 */
  toInput: (query: string) => Record<string, unknown>;
  /** 终态：从图最终 values 取回答（+可选脚注）。 */
  toResult: (values: S) => { answer: string; footer?: string };
  /** 注入给所有节点的额外 configurable（如 Send 并行实例读取）。 */
  configurable?: Record<string, unknown>;
  /** 递归上限（防 reflection 回边死循环）。 */
  recursionLimit?: number;
}
