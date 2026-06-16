/**
 * examples 共用件 —— 把各示例重复的样板收成一处：
 *   1. 取模型：getExampleModel / requireModel
 *   2. 工具调用三态透出（runTool）
 *   3. LLM content 抽文本（extractText）、人审「通过」判定（isApproval）
 *   4. LLM 韧性（withTimeout / withRetry / createConcurrencyLimiter）→ 复用 src/runtime/llm-resilience
 *
 * 故意放在 examples/（而非 src/）：示例专属 helper 与模板核心解耦；韧性原语已反哺到 src/runtime。
 * 各示例用相对路径 import：`import { requireModel, runTool } from "../shared.js";`
 */

import { randomUUID } from "node:crypto";
import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { resolveModel, logger, type AppConfig } from "../src/runtime/index.js";
import { createFileCheckpointer } from "../src/runtime/services/file-checkpoint-saver.js";
import type { ToolCallEvent, StageEvent, PlanEvent } from "../src/surfaces/flow-types.js";

// 模板级 LLM 韧性 —— 从 deep-research 实战反哺，默认图/compaction 同源实现
export {
  withTimeout,
  withRetry,
  createConcurrencyLimiter,
  invokeWithResilience,
  getSharedLlmLimiter,
  resolveLlmResilience,
  LLM_TIMEOUT_SHORT_MS,
  LLM_TIMEOUT_LONG_MS,
  LLM_DEFAULT_MAX_CONCURRENT,
} from "../src/runtime/services/llm-resilience.js";

const log = logger.child("example-shared");

/**
 * 长任务默认持久化：有 appConfig → FileCheckpointSaver（跨重启续跑）；
 * 无 appConfig（极少数纯单测）→ MemorySaver。单测可注入自己的 checkpointer 覆盖。
 * 各有状态示例的 createXxxFlow 统一经此决定 checkpointer，避免「示例忘了持久化」回归。
 */
export function durableCheckpointer(
  appConfig?: AppConfig,
  injected?: BaseCheckpointSaver
): BaseCheckpointSaver {
  if (injected) return injected;
  return appConfig ? createFileCheckpointer(appConfig) : new MemorySaver();
}

/**
 * 有凭证 → 返回 chat model；无凭证（本地 / CI）→ 返回 null。
 * 示例节点真实接入大模型、不降级 demo：拿到 null 的节点应经 requireModel 直接报错。
 * 检查标准 env 变量 + appConfig 声明的 apiKeyEnv/authTokenEnv，与默认图的 llm helper 同口径。
 */
export function getExampleModel(appConfig?: AppConfig) {
  const vars = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"];
  const model = appConfig?.model as
    | { apiKeyEnv?: string; authTokenEnv?: string }
    | undefined;
  if (model?.apiKeyEnv) vars.push(model.apiKeyEnv);
  if (model?.authTokenEnv) vars.push(model.authTokenEnv);

  if (!appConfig || !vars.some((v) => Boolean(process.env[v]))) {
    log.warn("无模型凭证 → requireModel 将直接报错（示例不降级 demo）");
    return null;
  }
  const resolved = resolveModel(appConfig);
  return resolved && typeof resolved !== "string" ? resolved : null;
}

/**
 * 真实接入：必须有模型，否则直接报错（不降级 demo fallback）。
 * 各示例的 LLM 节点统一经此取模型，错误信息一致。
 */
export function requireModel(appConfig?: AppConfig, exampleName = "本示例") {
  const model = getExampleModel(appConfig);
  if (!model) {
    throw new Error(
      `${exampleName}需要模型凭证（无 demo fallback）：在 env / .env 设 ANTHROPIC_API_KEY（或 ANTHROPIC_AUTH_TOKEN / OPENAI_API_KEY）`
    );
  }
  return model;
}

/**
 * 执行一个工具，并把过程经 onToolCall 透出（in_progress → completed/failed）。
 * 消除每个工具节点重复的「生成 id → 发 in_progress → try/catch → 发 completed/failed」样板。
 *
 * @returns { result, ok } —— result 为工具输出（失败时为错误信息），ok 标记成败。
 */
export async function runTool(
  toolName: string,
  args: Record<string, unknown>,
  fn: () => string | Promise<string>,
  onToolCall?: (e: ToolCallEvent) => void | Promise<void>
): Promise<{ result: string; ok: boolean }> {
  const toolCallId = randomUUID();
  if (onToolCall) {
    await onToolCall({ toolCallId, toolName, args, status: "in_progress" });
  }
  try {
    const result = await fn();
    // MCP 有时返回 "Unknown tool: xxx" 但不抛错 —— 视为失败，避免 ACP 显示 completed。
    const unknownTool =
      typeof result === "string" && /^Unknown tool:/i.test(result.trim());
    if (unknownTool) {
      if (onToolCall) {
        await onToolCall({
          toolCallId,
          toolName,
          args,
          status: "failed",
          error: result,
        });
      }
      return { result, ok: false };
    }
    if (onToolCall) {
      await onToolCall({ toolCallId, toolName, args, status: "completed", result });
    }
    return { result, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (onToolCall) {
      await onToolCall({ toolCallId, toolName, args, status: "failed", error: message });
    }
    return { result: message, ok: false };
  }
}

/**
 * LangGraph custom writer —— 经 streamMode:"custom" 进入 mapStreamChunk 归一管线。
 * 与 configurable.onStage/onPlan 双轨：writer 走多模式 stream，callbacks 兼容旧路径。
 */
type StreamWriter = (payload: Record<string, unknown>) => void;

function getWriter(
  config: { writer?: StreamWriter } | undefined
): StreamWriter | undefined {
  return config?.writer;
}

/** 阶段进度：writer + onStage 双发。 */
export async function emitStage(
  config:
    | {
        writer?: StreamWriter;
        configurable?: { onStage?: (e: StageEvent) => void | Promise<void> };
      }
    | undefined,
  e: StageEvent
): Promise<void> {
  const writer = getWriter(config);
  if (writer) {
    writer({ type: "stage", ...e });
    return;
  }
  const onStage = config?.configurable?.onStage;
  if (onStage) await onStage(e);
}

/** 结构化 Plan：writer + onPlan 双发。 */
export async function emitPlan(
  config:
    | {
        writer?: StreamWriter;
        configurable?: { onPlan?: (e: PlanEvent) => void | Promise<void> };
      }
    | undefined,
  entries: PlanEvent["entries"]
): Promise<void> {
  if (!entries.length) return;
  const writer = getWriter(config);
  if (writer) {
    writer({ type: "plan", entries });
    return;
  }
  const onPlan = config?.configurable?.onPlan;
  if (onPlan) await onPlan({ entries });
}

/** 流式文本 token：经 custom writer 进入 onToken 管线。 */
export function emitTextToken(
  config: { writer?: StreamWriter } | undefined,
  text: string
): void {
  if (!text) return;
  const writer = getWriter(config);
  if (writer) writer({ type: "text", text });
}

/**
 * 从 LLM 返回的 content 抽纯文本。
 * chunk.content 可能是 string，也可能是 content block 数组（多段文本）；统一拼成字符串。
 */
export function extractText(content: unknown): string {
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

/**
 * 人审「通过」判定：HITL 节点（review / travel / pm）共用。
 * 空回复（直接回车）视为通过；否则需精确匹配常见通过词，避免「不可以」被误判为「可以」。
 */
const APPROVAL_RE = /^(ok|okay|通过|可以|批准|approved?|confirm(ed)?|yes|好的?|lgtm)$/i;
export function isApproval(feedback: string): boolean {
  const fb = feedback.trim();
  return !fb || APPROVAL_RE.test(fb);
}
