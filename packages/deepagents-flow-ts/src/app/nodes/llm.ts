/**
 * LLM 辅助 —— 统一获取 flow 节点用的 chat model。
 *
 * 这是「LLM 节点 + 无凭证降级」模式的共用件(见 plan / reflect / respond)。
 * 无凭证(本地 / CI)时返回 null → 节点走启发式 fallback,保证图始终可跑、可测。
 * 真实模板里你可换成自己的模型解析;下面的凭证判断也可按需调整。
 */

import { resolveModel, type AppConfig } from "deepagents-app-ts/runtime";

function hasCredentials(): boolean {
  return Boolean(
    process.env.ANTHROPIC_API_KEY ||
      process.env.ANTHROPIC_AUTH_TOKEN ||
      process.env.OPENAI_API_KEY
  );
}

/** 有凭证且 appConfig 能解析出模型 → 返回实例;否则返回 null(调用方走 fallback)。 */
export function getFlowModel(appConfig?: AppConfig) {
  if (!appConfig || !hasCredentials()) return null;
  const model = resolveModel(appConfig);
  return model && typeof model !== "string" ? model : null;
}
