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
 *  4. **多模式 stream**：`streamMode: ["messages","tools","custom","updates"]` + mapStreamChunk
 *     归一后分发给 onToken/onPlan/onStage/onToolCall；Send 并行实例经 custom writer 也能透出。
 */

import {
  Command,
  INTERRUPT,
  MemorySaver,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import { type AppConfig } from "../runtime/index.js";
import { traceFlowCallbacks, traceFlowRun, isInAcpPromptCycle } from "../runtime/session-trace.js";
import type {
  StatefulFlow,
  FlowRunResult,
  FlowCallbacks,
} from "../core/flow-types.js";
import { applyCompaction } from "../app/compaction.js";
import { mapStreamChunk } from "./map-stream-chunk.js";
import { dispatchSurfaceEvent } from "./dispatch-surface-event.js";

/** LangGraph 多模式 stream 的 streamMode 列表。 */
const STREAM_MODES = ["messages", "tools", "custom", "updates"] as const;
type StreamRunnableConfig = RunnableConfig & { streamMode?: string[] };

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
  /** 写回状态（自动压缩用 RemoveMessage 替换历史；LangGraph compile 产物天然支持）。 */
  updateState(config: RunnableConfig, values: Record<string, unknown>): Promise<unknown>;
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
  /**
   * 传入则在「新 query（非 resume）」入口自动压缩 checkpoint 中累积的 `state.messages`
   * （超阈值摘要 + RemoveMessage 替换，见 app/compaction）。状态无 messages 或未超阈值时 no-op。
   */
  appConfig?: AppConfig;
}

/** 从 stream 各 chunk 里取最后一个 interrupt 的 value（沿用各示例既有约定）。 */
function pickInterruptValue(chunk: Record<string, unknown>): unknown {
  const intr = chunk[INTERRUPT] as Array<{ value?: unknown }> | undefined;
  return intr && intr.length ? intr[intr.length - 1]?.value : undefined;
}

/** 判断 stream chunk 是否为多模式 `[mode, payload]` 元组。 */
function isModeChunk(chunk: unknown): chunk is [string, unknown] {
  return Array.isArray(chunk) && typeof chunk[0] === "string" && chunk.length === 2;
}

/**
 * 消费 LangGraph stream，归一事件并分发给 callbacks；返回最后一个 interrupt question（若有）。
 */
async function consumeStream(
  stream: AsyncIterable<unknown>,
  callbacks?: FlowCallbacks
): Promise<string | undefined> {
  let interruptQuestion: string | undefined;
  let multiMode = false;

  for await (const raw of stream) {
    if (isModeChunk(raw)) {
      multiMode = true;
      const [mode, payload] = raw;
      const events = mapStreamChunk(mode, payload);
      for (const ev of events) {
        if (ev.type === "interrupt") {
          interruptQuestion = ev.question;
          continue;
        }
        const meta =
          mode === "messages" && Array.isArray(payload)
            ? (payload[1] as { langgraph_node?: string } | undefined)
            : undefined;
        await dispatchSurfaceEvent(ev, callbacks, meta);
      }
      continue;
    }

    // 兜底：旧式单模式 updates chunk（无 streamMode 时）
    if (!multiMode) {
      const v = pickInterruptValue(raw as Record<string, unknown>);
      if (v !== undefined) {
        interruptQuestion =
          (v as { question?: string })?.question ?? String(v);
      }
    }
  }

  return interruptQuestion;
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
      ...options.configurable,
      thread_id: threadId,
      // 节点仍可直接读 callbacks（与 writer 双轨兼容过渡期）
      onToolCall: callbacks?.onToolCall,
      onStage: callbacks?.onStage,
      onPlan: callbacks?.onPlan,
      onToken: callbacks?.onToken,
    },
    recursionLimit,
  });

  return {
    async run(input, threadId, callbacks): Promise<FlowRunResult> {
      const inputText = input.resume ?? input.query ?? "";
      const mode = input.resume !== undefined ? "resume" : "query";
      const inAcp = isInAcpPromptCycle();
      const traced = inAcp
        ? (callbacks ?? {})
        : traceFlowCallbacks(callbacks, { threadId, sessionId: threadId });

      const runBody = async (): Promise<FlowRunResult> => {
        const config = baseConfig(threadId, traced);

        if (options.appConfig && input.resume === undefined) {
          await applyCompaction(graph, config, options.appConfig);
        }

        const streamInput =
          input.resume !== undefined
            ? new Command({ resume: input.resume })
            : options.toInput(input.query ?? "");

        const streamConfig: StreamRunnableConfig = {
          ...config,
          streamMode: [...STREAM_MODES],
          ...(traced.signal ? { signal: traced.signal } : {}),
        };
        const stream = await graph.stream(streamInput, streamConfig);

        const interruptQuestion = await consumeStream(stream, traced);

        if (interruptQuestion !== undefined) {
          return { status: "interrupted", question: interruptQuestion };
        }

        const snapshot = await graph.getState(config);
        const { answer, footer } = options.toResult(snapshot.values as S);
        return { status: "done", answer, footer };
      };

      if (inAcp) return runBody();
      return traceFlowRun("stateful-flow", { threadId, mode, input: inputText }, runBody);
    },

    /**
     * 持久化推断：该 thread 是否已有 checkpoint（开过题）。
     * 有 checkpoint ⇒ 同一会话的续跑（interrupt / 出错 / 已完成皆然）；无 ⇒ 全新会话、首条开题。
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
