/**
 * think 节点 —— bindTools 的模型决定调工具（AIMessage.tool_calls）还是直接回答。
 *
 * 本节点**自管 model 解析 + bindTools**：工厂在创建时解析一次模型并绑定工具，返回的节点函数
 * 闭包持有 boundModel。无凭证 / 解析失败 / 调用失败都降级回显输入（step 标 `think#fallback`），
 * 保证图始终可跑、可测（见 tests/flow.test.ts）。
 */

import { AIMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import { resolveModel, logger, type AppConfig } from "../../runtime/index.js";
import { hasModelCredentials } from "../compaction.js";
import {
  invokeWithResilience,
  resolveLlmResilience,
} from "../../runtime/services/llm-resilience.js";
import type { FlowState } from "../state.js";

const log = logger.child("flow-think");

type BoundModel = {
  invoke: (m: BaseMessage[], options?: { signal?: AbortSignal }) => Promise<AIMessage>;
};

/** Model-like interface that has bindTools (BaseChatModel, ConfigurableModel, etc.) */
interface ModelWithTools {
  bindTools(tools: StructuredTool[]): BoundModel;
}

/** 仅在有 systemPrompt 且 messages 首条非 system 时，前置注入 SystemMessage。 */
function withSystemPrompt(messages: BaseMessage[], systemPrompt: string): BaseMessage[] {
  if (!systemPrompt) return messages;
  if (messages.length > 0 && messages[0]?._getType?.() === "system") return messages;
  return [new SystemMessage(systemPrompt), ...messages];
}

export interface ThinkNodeDeps {
  /** AppConfig（resolveModel / 韧性参数用）；反射拓扑或无凭证时可空。 */
  config?: AppConfig;
  /** 绑给模型的工具集（FlowRuntime.allTools）。 */
  allTools: StructuredTool[];
  /** 系统提示词（注入 SystemMessage）。 */
  systemPrompt?: string;
}

/** 创建 think 节点：解析一次模型 + bindTools，返回的节点函数闭包持有 boundModel。 */
export function createThinkNode(deps: ThinkNodeDeps) {
  const { config, allTools, systemPrompt } = deps;
  const hasCreds = hasModelCredentials(config);

  let boundModel: BoundModel | null = null;
  if (config && hasCreds) {
    try {
      const raw = resolveModel(config);
      if (raw && typeof raw !== "string") {
        // raw is a model instance (BaseChatModel, ConfigurableModel, etc.) that has bindTools
        const model = raw as unknown as ModelWithTools;
        boundModel = model.bindTools(allTools);
      }
    } catch (err) {
      log.warn("resolveModel/bindTools failed", { error: String(err) });
    }
  }

  return async (
    state: FlowState,
    runtimeConfig?: { signal?: AbortSignal }
  ): Promise<Partial<FlowState>> => {
    if (!boundModel || !hasCreds) {
      // 无凭证 fallback：直接回显输入为回答（不调工具，保证图始终可跑）
      return {
        messages: [new AIMessage({ content: `(无模型凭证，回显输入)\n${state.input}` })],
        steps: ["think#fallback: no model"],
      };
    }
    try {
      const { shortTimeoutMs } = resolveLlmResilience(config);
      const promptForModel = withSystemPrompt(state.messages, systemPrompt ?? "");
      log.debug("think 注入 systemPrompt", {
        systemPromptChars: systemPrompt?.trim().length ?? 0,
        messageCount: promptForModel.length,
        firstMessageType: promptForModel[0]?._getType?.() ?? "unknown",
      });
      const ai = await invokeWithResilience(
        boundModel,
        promptForModel,
        {
          timeoutMs: shortTimeoutMs,
          label: "think 调模型",
          retryLabel: "think LLM",
          config,
          signal: runtimeConfig?.signal,
        }
      );
      return {
        messages: [ai],
        steps: [`think: ${(ai.tool_calls ?? []).length} tool_calls`],
      };
    } catch (err) {
      // 重试用尽仍失败（限流/网络/超时）→ 降级回显，保证图收敛而非整图抛错
      log.warn("think invoke failed → fallback", { error: String(err), apiOk: false });
      return {
        messages: [new AIMessage({ content: `(模型调用失败，回显输入)\n${state.input}` })],
        steps: ["think#fallback: invoke error"],
      };
    }
  };
}
