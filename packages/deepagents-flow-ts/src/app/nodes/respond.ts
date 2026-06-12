/**
 * respond 节点 ——【模式:流式输出节点】。
 *
 * 由 observations 综合最终回答:有模型 + onToken → LLM stream(逐 token 经 onToken 推增量,
 * surface 据此发 ACP agent_message_chunk);否则 → 拼接降级。
 *
 * 这是「流式回答」样板:把图里累积的中间结果,在终点用 LLM 流式汇总给用户。
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { AppConfig } from "deepagents-app-ts/runtime";
import type { FlowState } from "../state.js";
import { getFlowModel } from "./llm.js";

const RESPOND_SYSTEM = "你是工作流的最终汇总步骤。基于工具观察,简洁回答用户输入。";

export async function respondNode(
  state: FlowState,
  appConfig?: AppConfig,
  onToken?: (token: string) => void | Promise<void>
): Promise<Partial<FlowState>> {
  const obs = (state.observations ?? [])
    .map((o) => `- ${o.tool}(${JSON.stringify(o.args)}) => ${o.result}`)
    .join("\n");
  const model = getFlowModel(appConfig);

  if (model && onToken) {
    try {
      let answer = "";
      const stream = await model.stream([
        new SystemMessage(RESPOND_SYSTEM),
        new HumanMessage(`输入:${state.input}\n工具观察:\n${obs || "(无)"}`),
      ]);
      for await (const chunk of stream) {
        const t = typeof chunk.content === "string" ? chunk.content : "";
        if (t) {
          answer += t;
          await onToken(t);
        }
      }
      return {
        output: answer,
        steps: [...(state.steps ?? []), `respond: streamed ${answer.length} chars`],
      };
    } catch {
      // 落到下面的 fallback
    }
  }

  // fallback:无凭证 / 无 onToken / 流式出错 → 拼接观察
  const output = obs
    ? `基于工具观察的回答:\n${obs}`
    : `(无工具观察)输入:${state.input}`;
  return { output, steps: [...(state.steps ?? []), "respond: fallback"] };
}
