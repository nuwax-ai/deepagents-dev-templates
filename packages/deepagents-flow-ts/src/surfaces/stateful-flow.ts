/**
 * createStatefulFlow —— 有状态长任务的统一基座（多轮 HITL + 跨重启续跑）。
 *
 * 在此之前，每个有状态示例（deep-research / travel / pm / human-in-loop）都各自手写一份
 * 几乎相同的 run-loop：建 config → `stream(Command resume)` vs `stream(初始 state)` →
 * 扫 chunk 找 `__interrupt__` → 返回 interrupted/done。本 helper 把这段收成一处，示例只需给出
 * 三件「图相关」的事：buildGraph / toInput / toResult。
 *
 * 长任务硬化点（相对手写版的增量）：
 *  1. **持久化默认开**：checkpointer 缺省也建议传 FileCheckpointSaver（见各示例 createFileCheckpointer），
 *     图状态/interrupt 落盘 → 进程/IDE 重启后仍可 resume。
 *  2. **续跑状态来自 checkpointer**：`hasStarted` 读 `graph.getState()` 是否已有 checkpoint，
 *     而非进程内存 Set → 一个会话只一个主题：首条开题、之后都续跑同一项目（interrupt/出错/已完成
 *     都不重头来），且重启后仍准。
 *  3. **递归护栏**：recursionLimit 防节点循环（reflection 回边）跑飞。
 *  4. **阶段/工具回调穿透**：onStage / onToolCall 经 configurable 注入，Send 并行实例也拿得到。
 */

import {
  Command,
  MemorySaver,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { logger } from "deepagents-app-ts/runtime";
import type {
  StatefulFlow,
  FlowRunResult,
  FlowCallbacks,
} from "./flow-types.js";

const log = logger.child("stateful-flow");

/**
 * createStatefulFlow 需要的「图」最小结构 —— LangGraph `.compile()` 的产物天然满足。
 * 用结构化类型而非 CompiledStateGraph 泛型，避免示例间为对齐复杂泛型而打架。
 */
export interface RunnableGraph {
  stream(
    input: unknown,
    config?: RunnableConfig
  ): Promise<AsyncIterable<unknown>>;
  getState(
    config: RunnableConfig
  ): Promise<{
    values: unknown;
    next?: readonly string[];
    /** 当前 checkpoint 的定位 config —— 有 checkpoint_id ⇒ 该 thread 已开过题（见 hasStarted）。 */
    config?: { configurable?: { checkpoint_id?: string } };
  }>;
}

export interface StatefulFlowOptions<S = Record<string, unknown>> {
  /**
   * 用传入的 checkpointer 编译图并返回。示例传 `(cp) => createXxxGraph(appConfig, cp)`。
   * 只在 createStatefulFlow 内调用一次（per-run 的回调走 configurable，不必每轮重编）。
   */
  buildGraph: (checkpointer: BaseCheckpointSaver) => RunnableGraph;
  /** 新任务：把用户 query 映射成图初始 state（如 `(q) => ({ topic: q })`）。 */
  toInput: (query: string) => Record<string, unknown>;
  /** 终态：从图最终 values 取回答（+可选脚注）。 */
  toResult: (values: S) => { answer: string; footer?: string };
  /**
   * 持久化后端。缺省 MemorySaver（仅供单测/无 config 时）；
   * 生产/示例应传 FileCheckpointSaver（createFileCheckpointer(appConfig)）→ 跨重启续跑。
   */
  checkpointer?: BaseCheckpointSaver;
  /** 注入给所有节点的额外 configurable（如 `{ appConfig }`，供 Send 并行实例读取）。 */
  configurable?: Record<string, unknown>;
  /** 递归上限（防 reflection 回边死循环）。默认 50。 */
  recursionLimit?: number;
}

/** 从 stream 各 chunk 里取最后一个 interrupt 的 value（沿用各示例既有约定）。 */
function pickInterruptValue(chunk: Record<string, unknown>): unknown {
  const intr = chunk.__interrupt__ as Array<{ value?: unknown }> | undefined;
  return intr && intr.length ? intr[intr.length - 1]?.value : undefined;
}

/**
 * 把图包成模板 StatefulFlow —— run-loop + 持久化 resume 一处实现，全示例共享。
 */
export function createStatefulFlow<S = Record<string, unknown>>(
  options: StatefulFlowOptions<S>
): StatefulFlow {
  const checkpointer = options.checkpointer ?? new MemorySaver();
  const recursionLimit = options.recursionLimit ?? 50;
  const graph = options.buildGraph(checkpointer);

  const baseConfig = (threadId: string, callbacks?: FlowCallbacks): RunnableConfig => ({
    configurable: {
      thread_id: threadId,
      onToolCall: callbacks?.onToolCall,
      onStage: callbacks?.onStage,
      ...options.configurable,
    },
    recursionLimit,
  });

  return {
    async run(input, threadId, callbacks): Promise<FlowRunResult> {
      const config = baseConfig(threadId, callbacks);
      const streamInput =
        input.resume !== undefined
          ? new Command({ resume: input.resume })
          : options.toInput(input.query ?? "");

      const stream = await graph.stream(streamInput, config);
      let interruptValue: unknown;
      for await (const chunk of stream) {
        const v = pickInterruptValue(chunk as Record<string, unknown>);
        if (v !== undefined) interruptValue = v;
      }

      if (interruptValue !== undefined) {
        const question =
          (interruptValue as { question?: string })?.question ??
          String(interruptValue);
        log.info("interrupted → 等待用户 resume", { threadId });
        return { status: "interrupted", question };
      }

      const snapshot = await graph.getState(config);
      const { answer, footer } = options.toResult(snapshot.values as S);
      return { status: "done", answer, footer };
    },

    /**
     * 持久化推断：该 thread 是否已有 checkpoint（开过题）。
     * 有 checkpoint ⇒ 同一会话的续跑（interrupt / 出错 / 已完成皆然）；无 ⇒ 全新会话、首条开题。
     * 用 checkpoint_id 而非 next>0：next>0 只覆盖「停在 interrupt/出错」，漏掉「已完成」——
     * 而已完成的会话再收到消息，也该续跑同一项目、不开新主题。
     */
    async hasStarted(threadId): Promise<boolean> {
      const snapshot = await graph.getState({
        configurable: { thread_id: threadId },
      });
      return (
        Boolean(snapshot.config?.configurable?.checkpoint_id) ||
        (snapshot.next?.length ?? 0) > 0
      );
    },
  };
}
