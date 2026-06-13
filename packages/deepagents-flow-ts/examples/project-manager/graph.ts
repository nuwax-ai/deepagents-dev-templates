/**
 * 示例：项目管理（project manager）——【真实接入：LLM 分解 → 估时 → 评估循环 + HITL 审批】
 *
 * 对应 LangGraph 官方：**Reflection / evaluator-optimizer**（评审不达标带意见重做）+ **Branching**（条件边）+ **HITL**。
 * 需求场景：把目标拆成任务、估时排期、评审计划是否完备（不完备就带意见重规划），最后人工审批。
 *
 *   START → plan → estimate → evaluate ─(条件边)─ 不完备 & 未达上限 → plan(带评审意见重规划)
 *                                      └ 否则 → approve(interrupt 审批) → finalize → END
 *
 * 真实接入（无 demo fallback——未配凭证直接报错）：
 *  - plan / estimate / evaluate / finalize **真调大模型**：plan 拆任务、estimate 估工期、
 *    evaluate 给「完备/不完备 + 评审意见」，不完备时把意见喂回 plan 形成 reflection 循环。
 *  - routeAfterEvaluate 是**纯函数**（条件边 + MAX_REPLAN 封顶），可单测、防死循环。
 *  - approve 用 interrupt 暂停，finalize 出确定性甘特排期。
 * ⚠️ 节点名不能与 channel 同名：channel 有 decision，所以评审节点叫 evaluate。
 */

import {
  StateGraph,
  START,
  END,
  Annotation,
  MemorySaver,
  interrupt,
  Command,
} from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "deepagents-app-ts/runtime";
import type { StatefulFlow, FlowRunResult } from "../../src/surfaces/flow-types.js";
import { requireModel, extractText, isApproval } from "../shared.js";

const log = logger.child("pm");

/** 重规划次数上限（防评估循环死循环）。 */
export const MAX_REPLAN = 2;
/** plan 提示里的任务数下限（教学用，传给 LLM）。 */
const MIN_TASKS = 3;

interface Task {
  name: string;
  days?: number;
}

const PMState = Annotation.Root({
  goal: Annotation<string>,
  tasks: Annotation<Task[]>,
  decision: Annotation<string>,
  /** 评审意见：不完备时喂回 plan 重规划（reflection 循环的核心载体）。 */
  critique: Annotation<string>,
  attempts: Annotation<number>,
  feedback: Annotation<string>,
  output: Annotation<string>,
});
export type PMStateType = typeof PMState.State;

/**
 * 从 LLM 文本里抽出第一段 JSON（容忍 ```json 围栏与前后说明文字）。
 * 解析失败直接抛——是「LLM 没按要求输出」的真实错误，不是 demo 降级。
 */
function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error(`LLM 未返回 JSON：${text.slice(0, 200)}`);
  const close = cleaned[start] === "[" ? "]" : "}";
  const end = cleaned.lastIndexOf(close);
  if (end <= start) throw new Error(`LLM JSON 不完整：${text.slice(0, 200)}`);
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

/** plan：LLM 把目标拆成任务；重规划轮把上一轮评审意见喂回去改进。 */
async function planNode(
  state: PMStateType,
  appConfig?: AppConfig
): Promise<Partial<PMStateType>> {
  const model = requireModel(appConfig, "project-manager 示例");
  const replan = (state.attempts ?? 0) > 0 && Boolean(state.critique);
  const res = await model.invoke([
    new SystemMessage(
      `你是资深项目经理。把目标拆解为 ${MIN_TASKS}–6 个有序、可执行、不重叠的关键任务（里程碑粒度）。` +
        `只输出任务名的 JSON 字符串数组，如 ["需求调研","方案设计"]，不要任何解释。`
    ),
    new HumanMessage(
      replan
        ? `目标：${state.goal}\n\n上一轮评审意见（请据此改进计划）：${state.critique}`
        : `目标：${state.goal}`
    ),
  ]);
  const names = parseJson<unknown[]>(extractText(res.content));
  log.info("plan", { attempts: state.attempts ?? 0, taskCount: names.length });
  return { tasks: names.map((n) => ({ name: String(n) })) };
}

/** estimate：LLM 给每个任务估工期（人天）。按输入顺序对齐。 */
async function estimateNode(
  state: PMStateType,
  appConfig?: AppConfig
): Promise<Partial<PMStateType>> {
  const model = requireModel(appConfig, "project-manager 示例");
  const res = await model.invoke([
    new SystemMessage(
      `为每个任务估算工期（人天，正整数）。只输出 JSON 数组：[{"name":"...","days":N}]，顺序与输入一致，不要解释。`
    ),
    new HumanMessage(
      `任务：\n${state.tasks.map((t, i) => `${i + 1}. ${t.name}`).join("\n")}`
    ),
  ]);
  const items = parseJson<Array<{ days?: number }>>(extractText(res.content));
  return {
    tasks: state.tasks.map((t, i) => ({
      ...t,
      days: Math.max(1, Math.round(Number(items[i]?.days) || 3)),
    })),
  };
}

/** evaluate：LLM 评审计划完备性，写 decision + critique + 累加 attempts。 */
async function evaluateNode(
  state: PMStateType,
  appConfig?: AppConfig
): Promise<Partial<PMStateType>> {
  const model = requireModel(appConfig, "project-manager 示例");
  const attempts = (state.attempts ?? 0) + 1;
  const plan = state.tasks
    .map((t, i) => `${i + 1}. ${t.name}（${t.days ?? "?"} 天）`)
    .join("\n");
  const res = await model.invoke([
    new SystemMessage(
      `你是项目评审。判断该计划是否完备、可执行、覆盖关键阶段（如需求、设计、实现、测试/上线）。` +
        `只输出 JSON：{"verdict":"complete"|"incomplete","critique":"一句话说明缺什么，或为何可通过"}。`
    ),
    new HumanMessage(`目标：${state.goal}\n计划：\n${plan}`),
  ]);
  const v = parseJson<{ verdict?: string; critique?: string }>(
    extractText(res.content)
  );
  const decision = v.verdict === "incomplete" ? "incomplete" : "complete";
  log.info("evaluate", { decision, tasks: state.tasks.length, attempts });
  return { decision, critique: v.critique ?? "", attempts };
}

/** 条件边（纯函数）：不完备且未达重规划上限 → 回 plan；否则 → approve。 */
export function routeAfterEvaluate(state: PMStateType): "plan" | "approve" {
  if (state.decision === "incomplete" && (state.attempts ?? 0) < MAX_REPLAN) {
    return "plan";
  }
  return "approve";
}

/** approve：interrupt 暂停，把计划抛给用户审批。 */
function approveNode(state: PMStateType): Partial<PMStateType> {
  const plan = state.tasks
    .map((t, i) => `${i + 1}. ${t.name}（${t.days ?? "?"} 天）`)
    .join("\n");
  const feedback = interrupt({
    question: `📋 项目计划（${state.goal}）：\n${plan}\n\n批准请回复「ok」，或提调整意见。`,
  });
  return { feedback: String(feedback ?? "").trim() };
}

/** finalize：批准则出确定性甘特排期；否则 LLM 按意见修订。 */
async function finalizeNode(
  state: PMStateType,
  appConfig?: AppConfig
): Promise<Partial<PMStateType>> {
  const fb = (state.feedback ?? "").trim();
  let cursor = 0;
  const gantt = state.tasks
    .map((t) => {
      const start = cursor;
      const dur = t.days ?? 3;
      cursor += dur;
      return `  ${t.name}：D${start + 1}–D${cursor}（${dur} 天）`;
    })
    .join("\n");
  if (isApproval(fb)) {
    return {
      output: `✅ 计划已批准（${state.goal}）\n排期（共 ${cursor} 天）：\n${gantt}`,
    };
  }
  const model = requireModel(appConfig, "project-manager 示例");
  const res = await model.invoke([
    new SystemMessage(
      "根据用户的调整意见修订项目计划，输出修订后的完整任务清单（含工期）与简要排期，不要解释。"
    ),
    new HumanMessage(`原排期：\n${gantt}\n\n调整意见：${fb}`),
  ]);
  return {
    output: `✏️ 已按意见调整（${state.goal}）：${fb}\n${extractText(res.content).trim()}`,
  };
}

export function createPMGraph(appConfig?: AppConfig) {
  return new StateGraph(PMState)
    .addNode("plan", (s: PMStateType) => planNode(s, appConfig))
    .addNode("estimate", (s: PMStateType) => estimateNode(s, appConfig))
    .addNode("evaluate", (s: PMStateType) => evaluateNode(s, appConfig))
    .addNode("approve", approveNode)
    .addNode("finalize", (s: PMStateType) => finalizeNode(s, appConfig))
    .addEdge(START, "plan")
    .addEdge("plan", "estimate")
    .addEdge("estimate", "evaluate")
    .addConditionalEdges("evaluate", routeAfterEvaluate, {
      plan: "plan",
      approve: "approve",
    })
    .addEdge("approve", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer: new MemorySaver() });
}

/** 包装成模板 StatefulFlow：run({query})→评估循环跑到 approve 的 interrupt；run({resume})→finalize。 */
export function createPMFlow(appConfig?: AppConfig): StatefulFlow {
  const graph = createPMGraph(appConfig);
  return {
    async run(input, threadId): Promise<FlowRunResult> {
      const config = { configurable: { thread_id: threadId } };
      const stream =
        input.resume !== undefined
          ? await graph.stream(new Command({ resume: input.resume }), config)
          : await graph.stream({ goal: input.query ?? "" }, config);

      let interruptValue: unknown;
      for await (const chunk of stream) {
        const intr = (chunk as Record<string, unknown>).__interrupt__ as
          | Array<{ value?: unknown }>
          | undefined;
        if (intr && intr.length) interruptValue = intr[0]?.value;
      }

      if (interruptValue !== undefined) {
        const q =
          (interruptValue as { question?: string })?.question ??
          String(interruptValue);
        return { status: "interrupted", question: q };
      }
      const snapshot = await graph.getState(config);
      return { status: "done", answer: (snapshot.values as PMStateType).output ?? "" };
    },
  };
}
