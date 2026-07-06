/**
 * think 节点 —— bindTools 的模型决定调工具（AIMessage.tool_calls）还是直接回答。
 *
 * 本节点**自管 model 解析 + bindTools**：工厂在创建时解析一次模型并绑定工具，返回的节点函数
 * 闭包持有 boundModel。
 * - **无凭证**：降级回显输入（保证 CLI 冒烟 / 单测可跑，见 tests/flow.test.ts）。
 * - **有凭证但解析或调用失败**：抛错，由 ACP/CLI surface 向用户暴露真实失败（不伪装成功）。
 */

import { AIMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import { resolveModel, logger, type AppConfig } from "../../runtime/index.js";
import { hasModelCredentials } from "../../libs/compaction.js";
import {
  invokeWithResilience,
  resolveLlmResilience,
} from "../../runtime/services/llm-resilience.js";
import type { FlowState } from "../state.js";

const log = logger.child("flow-think");

/** 识别消息类型：类实例用 _getType()，checkpoint 反序列化对象用 type 字段。 */
function msgType(msg: BaseMessage): string {
  const raw = msg as unknown as Record<string, unknown>;
  if (typeof raw._getType === "function") {
    return (raw._getType as () => string)();
  }
  return typeof raw.type === "string" ? raw.type : "";
}

function msgToolCalls(
  msg: BaseMessage
): Array<{ id?: string; name: string; args: Record<string, unknown> }> {
  const raw = (msg as unknown as Record<string, unknown>).tool_calls;
  return Array.isArray(raw)
    ? (raw as Array<{ id?: string; name: string; args: Record<string, unknown> }>)
    : [];
}

function msgToolCallId(msg: BaseMessage): string {
  const raw = (msg as unknown as Record<string, unknown>).tool_call_id;
  return typeof raw === "string" ? raw : "";
}

/**
 * 移除 AIMessage 中缺少对应 ToolMessage 的孤立 tool_calls。
 * checkpoint 反序列化后消息可能是 plain object，不能用 instanceof 判断。
 */
export function sanitizeToolCalls(messages: BaseMessage[]): BaseMessage[] {
  const toolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msgType(msg) === "tool" && msgToolCallId(msg)) {
      toolCallIds.add(msgToolCallId(msg));
    }
  }
  const orphaned = new Set<string>();
  for (const msg of messages) {
    if (msgType(msg) !== "ai") continue;
    for (const c of msgToolCalls(msg)) {
      if (c.id && !toolCallIds.has(c.id)) {
        orphaned.add(c.id);
      }
    }
  }
  if (orphaned.size === 0) return messages;
  log.warn("发现孤立 tool_calls，已移除", { orphanedCount: orphaned.size, ids: [...orphaned] });
  return messages.map((msg) => {
    if (msgType(msg) !== "ai") return msg;
    const raw = msg as unknown as Record<string, unknown>;
    const calls = msgToolCalls(msg);
    const valid = calls.filter((c) => !(c.id && orphaned.has(c.id)));
    if (valid.length === calls.length) return msg;
    return new AIMessage({
      content: (raw.content as string | undefined) ?? "",
      additional_kwargs: raw.additional_kwargs as Record<string, unknown> | undefined,
      tool_calls: valid.length > 0 ? (valid as AIMessage["tool_calls"]) : undefined,
      id: typeof raw.id === "string" ? raw.id : undefined,
      name: typeof raw.name === "string" ? raw.name : undefined,
    });
  });
}

type BoundModel = {
  invoke: (m: BaseMessage[], options?: { signal?: AbortSignal }) => Promise<AIMessage>;
};

/** Model-like interface that has bindTools (BaseChatModel, ConfigurableModel, etc.) */
interface ModelWithTools {
  bindTools(tools: StructuredTool[]): BoundModel;
}

/**
 * 前置注入 SystemMessage（首条已是 system 则跳过）。
 *
 * Anthropic 协议：给 system 块打 ephemeral 缓存断点 → 位置式缓存覆盖「tools + system」整块
 * （最大的稳定前缀，含全部工具 schema），多轮第二轮起命中、显著降 TTFT（对标 nuwaxcode
 * packages/llm 的 caching-on-by-default）。OpenAI 兼容端点是隐式服务端缓存、无需标记，按原字符串注入。
 */
function withSystemPrompt(
  messages: BaseMessage[],
  systemPrompt: string,
  provider?: string
): BaseMessage[] {
  if (!systemPrompt) return messages;
  if (messages.length > 0 && messages[0]?._getType?.() === "system") return messages;
  return [buildSystemMessage(systemPrompt, provider), ...messages];
}

/** provider 感知地造 SystemMessage：anthropic 带 cache_control 缓存断点，其余裸字符串。 */
function buildSystemMessage(systemPrompt: string, provider?: string): SystemMessage {
  if (provider === "anthropic") {
    // cache_control 不在 core 的 system content 类型里（由 @langchain/anthropic 在 wire 层读取），故整体 cast。
    return new SystemMessage({
      content: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    } as unknown as ConstructorParameters<typeof SystemMessage>[0]);
  }
  return new SystemMessage(systemPrompt);
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
  /** resolveModel/bindTools 失败时保留原因，有凭证时节点内抛出让 surface 处理 */
  let resolveError: unknown = null;
  if (config && hasCreds) {
    try {
      const raw = resolveModel(config);
      if (raw && typeof raw !== "string") {
        // raw is a model instance (BaseChatModel, ConfigurableModel, etc.) that has bindTools
        const model = raw as unknown as ModelWithTools;
        boundModel = model.bindTools(allTools);
      }
    } catch (err) {
      resolveError = err;
      log.warn("resolveModel/bindTools failed", { error: String(err) });
    }
  }

  return async (
    state: FlowState,
    runtimeConfig?: { signal?: AbortSignal }
  ): Promise<Partial<FlowState>> => {
    if (!hasCreds) {
      // 无凭证 fallback：直接回显输入为回答（不调工具，保证图始终可跑）
      return {
        messages: [new AIMessage({ content: `(无模型凭证，回显输入)\n${state.input}` })],
        steps: ["think#fallback: no model"],
      };
    }
    if (!boundModel) {
      const detail = resolveError ? String(resolveError) : "model instance unavailable";
      throw new Error(`think: 模型解析失败（已配置凭证）: ${detail}`);
    }
    const { shortTimeoutMs } = resolveLlmResilience(config);
    const cleanMessages = sanitizeToolCalls(state.messages);
    const promptForModel = withSystemPrompt(
      cleanMessages,
      systemPrompt ?? "",
      config?.model.provider
    );
    log.debug("think 注入 systemPrompt", {
      systemPromptChars: systemPrompt?.trim().length ?? 0,
      messageCount: promptForModel.length,
      firstMessageType: promptForModel[0]?._getType?.() ?? "unknown",
    });
    // 有凭证时调用失败直接抛错，避免回显输入伪装成功（ACP stopReason=end_turn 误导用户）
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
  };
}
