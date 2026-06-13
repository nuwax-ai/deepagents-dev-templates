/**
 * reflect 节点 + 条件路由 ——【模式:条件边 + 循环 + 上限】(编排核心展示点)。
 *
 * 判 done / continue:有模型凭证 → LLM 判断是否还需再调工具;无凭证 → 启发式(有观察就够)。
 * 之后用 `addConditionalEdges(routeAfterReflect)` 在运行时选边:
 * continue 且未达 MAX_ITERS → 回 think(再来一轮);否则 → respond(收尾)。
 *
 * 这是「带反馈环的图」样板:一条直线流水线由此变成可迭代收敛的循环,且用上限保证不死循环。
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { logger, type AppConfig } from "deepagents-app-ts/runtime";
import type { FlowState } from "../state.js";
import { getFlowModel } from "./llm.js";

const log = logger.child("flow-reflect");

/** 最大迭代轮次(think → act → observe → reflect ×N)。封顶防死循环。 */
export const MAX_ITERS = 3;

const REFLECT_SYSTEM = `你是工作流的"反思"步骤。根据输入和已有工具观察,判断是否还需要再调一次工具。
只返回 JSON:{"decision":"continue"} 或 {"decision":"done"}`;

/** 从模型输出里解析 decision;只有精确等于 "continue" 才继续,否则 done。 */
export function parseDecision(text: string): "continue" | "done" {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]) as { decision?: unknown };
      return parsed.decision === "continue" ? "continue" : "done";
    } catch {
      // 解析失败 → 视为 done(安全收敛)
    }
  }
  return "done";
}

export async function reflectNode(
  state: FlowState,
  appConfig?: AppConfig
): Promise<Partial<FlowState>> {
  let decision: "continue" | "done";
  const model = getFlowModel(appConfig);

  if (model) {
    try {
      const obs = (state.observations ?? [])
        .map((o) => `${o.tool} => ${o.result}`)
        .join("\n");
      const res = await model.invoke([
        new SystemMessage(REFLECT_SYSTEM),
        new HumanMessage(`输入:${state.input}\n观察:\n${obs || "(无)"}`),
      ]);
      const text =
        typeof res.content === "string" ? res.content : JSON.stringify(res.content);
      // 只认 JSON 里 decision==="continue";避免模型散文里出现 "continue" 字样误判
      decision = parseDecision(text);
    } catch {
      decision = "done";
    }
  } else {
    // fallback:已有观察即认为够用(1 轮收敛)
    decision = (state.observations?.length ?? 0) > 0 ? "done" : "continue";
  }

  log.info("reflect", { decision, attempts: state.attempts ?? 0 });
  return {
    decision,
    steps: [...(state.steps ?? []), `reflect: ${decision}`],
  };
}

/** 条件边:reflect →(continue & 未达上限 → think | 否则 → respond)。 */
export function routeAfterReflect(state: FlowState): "think" | "respond" {
  const attempts = state.attempts ?? 0;
  if (state.decision === "continue" && attempts < MAX_ITERS) {
    log.info("route → think (continue)", { attempts });
    return "think";
  }
  log.info("route → respond", { attempts, decision: state.decision });
  return "respond";
}
