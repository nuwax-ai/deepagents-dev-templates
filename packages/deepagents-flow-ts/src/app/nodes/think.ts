/**
 * think 节点 ——【模式:LLM 节点 + 结构化输出 + 启发式 fallback】。
 *
 * 给定 input + 已有 observations,决定下一步用哪个工具 / 参数(ReAct 的 Thought→Action)。
 * 结果写入 state.plan channel(注意:节点名 think,channel 名 plan —— 不能同名,LangGraph 限制)。
 *  - 有模型凭证:让 LLM 出 JSON {tool, args, reason};
 *  - 无凭证:启发式(输入像算术 → calculate,否则 → echo)。
 *
 * 这是「LLM 节点」的样板:resolveModel → 构造 System/Human 消息 → invoke → 解析结构化结果;
 * 解析失败或出错都安全降级到 fallback,绝不阻断图。
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { AppConfig } from "deepagents-app-ts/runtime";
import type { FlowState, PlanStep } from "../state.js";
import { getFlowModel } from "./llm.js";
import { DEMO_TOOLS } from "./tools.js";

const THINK_SYSTEM = `你是工作流的"思考"步骤。根据用户输入和已有工具观察,决定下一步调用哪个工具。
可用工具:
- echo {text}：回显文本
- calculate {expression}：算术求值,如 "2 + 3 * 4"
- time：当前时间
只返回 JSON：{"tool":"<name>","args":{...},"reason":"<一句话>"}`;

function looksLikeMath(s: string): boolean {
  return /[0-9].*[-+*/].*[0-9]/.test(s);
}

/** 无凭证 / LLM 失败时的降级规划。 */
function fallbackPlan(state: FlowState): PlanStep {
  if (looksLikeMath(state.input)) {
    const m = state.input.match(/[-+/*().0-9\s]+/);
    return {
      tool: "calculate",
      args: { expression: (m?.[0] ?? "0").trim() },
      reason: "fallback: 检测到算术表达式",
    };
  }
  return { tool: "echo", args: { text: state.input }, reason: "fallback: 回显输入" };
}

/** 解析模型输出的 plan JSON;只接受 tool 已知 + args 为对象的合法结构,否则 null(走 fallback)。 */
export function safeParsePlan(raw: string): PlanStep | null {
  try {
    const p = JSON.parse(raw) as Partial<PlanStep>;
    if (
      typeof p.tool === "string" &&
      DEMO_TOOLS[p.tool] &&
      typeof p.args === "object" &&
      p.args
    ) {
      return {
        tool: p.tool,
        args: p.args as Record<string, unknown>,
        reason: typeof p.reason === "string" ? p.reason : undefined,
      };
    }
  } catch {
    // 解析失败 → null(走 fallback)
  }
  return null;
}

export async function thinkNode(
  state: FlowState,
  appConfig?: AppConfig
): Promise<Partial<FlowState>> {
  const attempts = (state.attempts ?? 0) + 1;
  const model = getFlowModel(appConfig);
  let plan: PlanStep;

  if (model) {
    try {
      const obs = (state.observations ?? [])
        .map((o) => `${o.tool}(${JSON.stringify(o.args)}) => ${o.result}`)
        .join("\n");
      const res = await model.invoke([
        new SystemMessage(THINK_SYSTEM),
        new HumanMessage(`输入:${state.input}\n已有观察:\n${obs || "(无)"}`),
      ]);
      const text =
        typeof res.content === "string" ? res.content : JSON.stringify(res.content);
      const match = text.match(/\{[\s\S]*\}/);
      const parsed = match ? safeParsePlan(match[0]) : null;
      plan = parsed ?? fallbackPlan(state);
    } catch {
      plan = fallbackPlan(state);
    }
  } else {
    plan = fallbackPlan(state);
  }

  return {
    attempts,
    plan,
    steps: [
      ...(state.steps ?? []),
      `think#${attempts}: ${plan.tool}(${JSON.stringify(plan.args)})`,
    ],
  };
}
