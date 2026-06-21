/**
 * project-manager 拓扑图 —— reflection 评估循环 + HITL 审批（自 examples/project-manager 提升）。
 *
 *   START → plan → estimate → evaluate ─(条件边)─ 不完备 & 未达上限 → plan(带评审意见重规划)
 *                                      └ 否则 → approve(interrupt 审批) → finalize → END
 *
 * 复用框架 factory：plan/estimate/evaluate=createLlmNode；approve=createHumanApprovalNode。
 * routeAfterEvaluate 保留为纯条件边函数（反射路由天生纯函数，导出供单测、防死循环）。
 * finalize 保留 bespoke（isApproval 短路 + 确定性甘特排期）。
 *
 * systemPrompt 注入主节点 plan（替换角色开场，保留 JSON 契约指令）；其余节点领域默认。
 * 零 surface 依赖 —— 可放 libs；createStatefulFlow 包装由 root / examples 各自做。
 */
import {
  StateGraph,
  START,
  END,
  Annotation,
  MemorySaver,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "../../../runtime/index.js";
import {
  createLlmNode,
  createHumanApprovalNode,
  parseJson,
  extractText,
  isApproval,
  requireModel,
} from "../../nodes/index.js";
import {
  invokeWithResilience,
  resolveLlmResilience,
} from "../../../runtime/services/llm-resilience.js";

const log = logger.child("pm");

/** 重规划次数上限（防评估循环死循环）。 */
export const MAX_REPLAN = 2;
/** plan 提示里的任务数下限（教学用，传给 LLM）。 */
const MIN_TASKS = 3;

interface Task {
  name: string;
  days?: number;
}

export const PMState = Annotation.Root({
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

/** 条件边（纯函数）：不完备且未达重规划上限 → 回 plan；否则 → approve。导出供单测。 */
export function routeAfterEvaluate(state: PMStateType): "plan" | "approve" {
  if (state.decision === "incomplete" && (state.attempts ?? 0) < MAX_REPLAN) {
    return "plan";
  }
  return "approve";
}

/** finalize：批准则出确定性甘特排期；否则 LLM 按意见修订。
 *  保留 bespoke——isApproval 短路 + 确定性甘特，非纯 LLM 节点。 */
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
  const model = requireModel(appConfig, "project-manager 拓扑");
  const { longTimeoutMs } = resolveLlmResilience(appConfig);
  const res = await invokeWithResilience(
    model,
    [
      new SystemMessage(
        "根据用户的调整意见修订项目计划，输出修订后的完整任务清单（含工期）与简要排期，不要解释。"
      ),
      new HumanMessage(`原排期：\n${gantt}\n\n调整意见：${fb}`),
    ],
    {
      timeoutMs: longTimeoutMs,
      label: "pm finalize",
      retryLabel: "pm LLM",
      config: appConfig,
    }
  );
  return {
    output: `✏️ 已按意见调整（${state.goal}）：${fb}\n${extractText(res.content).trim()}`,
  };
}

/**
 * 创建 PM 图（编译后的 LangGraph）。
 * @param systemPrompt plan 节点角色开场（scaffold 注入；缺省「资深项目经理」），JSON 契约指令不变。
 */
export function createPMGraph(
  appConfig?: AppConfig,
  checkpointer: BaseCheckpointSaver = new MemorySaver(),
  systemPrompt?: string
) {
  const role = systemPrompt?.trim() || "你是资深项目经理";

  // plan：框架 createLlmNode（parse JSON 任务名数组；重规划轮把评审意见喂回）。
  const plan = createLlmNode<PMStateType>({
    model: () => requireModel(appConfig, "project-manager 拓扑"),
    prompt: (s) => {
      const replan = (s.attempts ?? 0) > 0 && Boolean(s.critique);
      return [
        new SystemMessage(
          `${role}。把目标拆解为 ${MIN_TASKS}–6 个有序、可执行、不重叠的关键任务（里程碑粒度）。` +
            `只输出任务名的 JSON 字符串数组，如 ["需求调研","方案设计"]，不要任何解释。`
        ),
        new HumanMessage(
          replan
            ? `目标：${s.goal}\n\n上一轮评审意见（请据此改进计划）：${s.critique}`
            : `目标：${s.goal}`
        ),
      ];
    },
    parse: (text) => parseJson<unknown[]>(text),
    write: (r, s) => {
      const names = r.parsed as unknown[];
      log.info("plan", { attempts: s.attempts ?? 0, taskCount: names.length });
      return { tasks: names.map((n) => ({ name: String(n) })) };
    },
    config: appConfig,
    label: "pm plan",
    retryLabel: "pm LLM",
    timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs,
  });

  // estimate：框架 createLlmNode（parse JSON 工期数组，按序对齐）。
  const estimate = createLlmNode<PMStateType>({
    model: () => requireModel(appConfig, "project-manager 拓扑"),
    prompt: (s) => [
      new SystemMessage(
        `为每个任务估算工期（人天，正整数）。只输出 JSON 数组：[{"name":"...","days":N}]，顺序与输入一致，不要解释。`
      ),
      new HumanMessage(`任务：\n${s.tasks.map((t, i) => `${i + 1}. ${t.name}`).join("\n")}`),
    ],
    parse: (text) => parseJson<Array<{ days?: number }>>(text),
    write: (r, s) => ({
      tasks: s.tasks.map((t, i) => ({
        ...t,
        days: Math.max(
          1,
          Math.round(Number((r.parsed as Array<{ days?: number }>)[i]?.days) || 3)
        ),
      })),
    }),
    config: appConfig,
    label: "pm estimate",
    retryLabel: "pm LLM",
    timeoutMs: resolveLlmResilience(appConfig).shortTimeoutMs,
  });

  // evaluate：框架 createLlmNode（parse JSON verdict；attempts:1 不重试）。
  const evaluate = createLlmNode<PMStateType>({
    model: () => requireModel(appConfig, "project-manager 拓扑"),
    prompt: (s) => {
      const planText = s.tasks
        .map((t, i) => `${i + 1}. ${t.name}（${t.days ?? "?"} 天）`)
        .join("\n");
      return [
        new SystemMessage(
          `你是项目评审。判断该计划是否完备、可执行、覆盖关键阶段（如需求、设计、实现、测试/上线）。` +
            `只输出 JSON：{"verdict":"complete"|"incomplete","critique":"一句话说明缺什么，或为何可通过"}。`
        ),
        new HumanMessage(`目标：${s.goal}\n计划：\n${planText}`),
      ];
    },
    parse: (text) => parseJson<{ verdict?: string; critique?: string }>(text),
    write: (r, s) => {
      const v = r.parsed as { verdict?: string; critique?: string };
      const decision = v.verdict === "incomplete" ? "incomplete" : "complete";
      const attempts = (s.attempts ?? 0) + 1;
      log.info("evaluate", { decision, tasks: s.tasks.length, attempts });
      return { decision, critique: v.critique ?? "", attempts };
    },
    config: appConfig,
    label: "pm evaluate",
    retryLabel: "pm LLM",
    attempts: 1,
    timeoutMs: resolveLlmResilience(appConfig).shortTimeoutMs,
  });

  // approve：框架 createHumanApprovalNode（interrupt 把计划抛给用户审批 → 写 feedback）。
  const approve = createHumanApprovalNode<PMStateType>({
    question: (s) => {
      const planText = s.tasks
        .map((t, i) => `${i + 1}. ${t.name}（${t.days ?? "?"} 天）`)
        .join("\n");
      return `📋 项目计划（${s.goal}）：\n${planText}\n\n批准请回复「ok」，或提调整意见。`;
    },
    write: (feedback) => ({ feedback }),
  });

  return new StateGraph(PMState)
    .addNode("plan", plan)
    .addNode("estimate", estimate)
    .addNode("evaluate", evaluate)
    .addNode("approve", approve)
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
    .compile({ checkpointer });
}
