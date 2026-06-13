/**
 * respond 节点 ——【模式:流式输出节点】。
 *
 * 由 observations 综合最终回答:
 *  - 有模型 + onToken → LLM stream(逐 token 经 onToken 推增量,surface 据此发 ACP agent_message_chunk);
 *  - 有模型、无 onToken(如 CLI)→ LLM invoke(非流式,仍走模型汇总,只是不分片);
 *  - 无模型 / 结果为空 / 调用出错 → 拼接降级。
 *
 * 出错保护:若流式已推过部分 token,返回已累积的部分(与已展示给客户端的一致),
 * 不用拼接 fallback 覆盖,避免「半句真回答 + 一段拼接」的自相矛盾。
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { AppConfig } from "deepagents-app-ts/runtime";
import type { FlowState } from "../state.js";
import { getFlowModel } from "./llm.js";

const RESPOND_SYSTEM = "你是工作流的最终汇总步骤。基于工具观察,简洁回答用户输入。";

/** chunk.content 可能是 string 或 content block 数组(如多段文本);统一抽成纯文本。 */
export function chunkToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) =>
        b && typeof b === "object" && "text" in b
          ? String((b as { text: unknown }).text)
          : ""
      )
      .join("");
  }
  return "";
}

export async function respondNode(
  state: FlowState,
  appConfig?: AppConfig,
  onToken?: (token: string) => void | Promise<void>
): Promise<Partial<FlowState>> {
  const obs = (state.observations ?? [])
    .map((o) => `- ${o.tool}(${JSON.stringify(o.args)}) => ${o.result}`)
    .join("\n");
  const model = getFlowModel(appConfig);

  if (model) {
    const messages = [
      new SystemMessage(RESPOND_SYSTEM),
      new HumanMessage(`输入:${state.input}\n工具观察:\n${obs || "(无)"}`),
    ];
    let answer = "";
    try {
      if (onToken) {
        const stream = await model.stream(messages);
        for await (const chunk of stream) {
          const t = chunkToText(chunk.content);
          if (t) {
            answer += t;
            await onToken(t);
          }
        }
      } else {
        const res = await model.invoke(messages);
        answer = chunkToText(res.content);
      }
    } catch {
      // 流式 / 调用出错:已推过 token 就返回已累积部分(与客户端一致);否则落 fallback
      if (answer) {
        return {
          output: answer,
          steps: [
            ...(state.steps ?? []),
            `respond: partial ${answer.length} chars (after error)`,
          ],
        };
      }
    }
    if (answer) {
      return {
        output: answer,
        steps: [
          ...(state.steps ?? []),
          `respond: ${onToken ? "streamed" : "invoked"} ${answer.length} chars`,
        ],
      };
    }
  }

  // fallback:无凭证 / 无模型 / 结果为空 / 调用出错且未产出 → 拼接观察
  const output = obs
    ? `基于工具观察的回答:\n${obs}`
    : `(无工具观察)输入:${state.input}`;
  return { output, steps: [...(state.steps ?? []), "respond: fallback"] };
}
