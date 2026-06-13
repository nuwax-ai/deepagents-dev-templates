/**
 * LLM 辅助 —— 统一获取 flow 节点用的 chat model。
 *
 * 这是「LLM 节点 + 无凭证降级」模式的共用件(见 think / reflect / respond)。
 * 无凭证(本地 / CI)时返回 null → 节点走启发式 fallback,保证图始终可跑、可测。
 */

import { logger, resolveModel, type AppConfig } from "deepagents-app-ts/runtime";

const log = logger.child("flow-llm");

/** 是否存在任一可用凭证:标准 env 变量 + appConfig 声明的 apiKeyEnv/authTokenEnv。 */
function hasCredentials(appConfig?: AppConfig): boolean {
  const vars = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"];
  const model = appConfig?.model as { apiKeyEnv?: string; authTokenEnv?: string } | undefined;
  if (model?.apiKeyEnv) vars.push(model.apiKeyEnv);
  if (model?.authTokenEnv) vars.push(model.authTokenEnv);
  return vars.some((v) => Boolean(process.env[v]));
}

/**
 * 有凭证且 appConfig 能解析出模型 → 返回实例;否则返回 null(调用方走 fallback)。
 * 无凭证时打一条 warn,避免「LLM 路径被静默跳过」难以察觉。
 */
export function getFlowModel(appConfig?: AppConfig) {
  if (!appConfig) return null;
  if (!hasCredentials(appConfig)) {
    log.warn("无模型凭证 → LLM 节点将走启发式 fallback", {
      provider: appConfig.model?.provider,
    });
    return null;
  }
  const model = resolveModel(appConfig);
  return model && typeof model !== "string" ? model : null;
}
