/**
 * examples 共用件 —— 仅留示例专属的「模型凭证策略」。
 *
 * 通用节点构建件已下沉框架（框架为核心、示例消费框架实现）：
 *  - 节点 factory + 支撑原语:src/libs/nodes(createLlmNode、createToolExecNode、createHumanApprovalNode、createPrepareNode + extractText、parseJson、emit 系列、runTool、isApproval、streamLLMText)
 *  - checkpointer 选择:src/runtime/services/file-checkpoint-saver(durableCheckpointer)
 *  - 韧性原语:src/runtime/services/llm-resilience(withTimeout/withRetry/invokeWithResilience/...)
 * 各示例直接从 src/ import；本文件只保留 requireModel（示例「无 demo fallback」凭证策略，
 * 框架默认图有自己的 resolveModel）。各示例用相对路径：`import { requireModel } from "../shared.js";`
 */

import { resolveModel, logger, type AppConfig } from "../src/runtime/index.js";

const log = logger.child("example-shared");

/**
 * 真实接入：必须有模型，否则直接报错（不降级 demo fallback）。
 * 各示例的 LLM 节点统一经此取模型，错误信息一致。
 */
export function requireModel(appConfig?: AppConfig, exampleName = "本示例") {
  const vars = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"];
  const model = appConfig?.model as
    | { apiKeyEnv?: string; authTokenEnv?: string }
    | undefined;
  if (model?.apiKeyEnv) vars.push(model.apiKeyEnv);
  if (model?.authTokenEnv) vars.push(model.authTokenEnv);

  if (!appConfig || !vars.some((v) => Boolean(process.env[v]))) {
    log.warn("无模型凭证 → 示例不降级 demo，直接报错");
    throw new Error(
      `${exampleName}需要模型凭证（无 demo fallback）：在 env / .env 设 ANTHROPIC_API_KEY（或 ANTHROPIC_AUTH_TOKEN / OPENAI_API_KEY）`
    );
  }

  const resolved = resolveModel(appConfig);
  if (!resolved || typeof resolved === "string") {
    throw new Error(
      `${exampleName}需要模型凭证（无 demo fallback）：在 env / .env 设 ANTHROPIC_API_KEY（或 ANTHROPIC_AUTH_TOKEN / OPENAI_API_KEY）`
    );
  }
  return resolved;
}
