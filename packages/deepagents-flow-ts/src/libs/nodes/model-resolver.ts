/**
 * requireModel —— 「无 demo fallback」模型凭证策略（自 examples/shared.ts 提升）。
 *
 * 通用节点 factory（createLlmNode 等）不强制凭证；本函数给「真实接入」的拓扑/示例用：
 * 必须有模型凭证，否则直接报错（不降级 demo）。各拓扑节点统一经此取模型，错误信息一致。
 *
 * 提升自 examples/shared.ts（P1：拓扑进 libs 前先把共享件落 src）。runtime 的 resolveModel
 * 是框架默认图的模型解析；requireModel 是其「硬凭证」包装。
 */
import { resolveModel, logger, type AppConfig } from "../../runtime/index.js";

const log = logger.child("model-resolver");

/**
 * 真实接入：必须有模型，否则直接报错（不降级 demo fallback）。
 */
export function requireModel(appConfig?: AppConfig, exampleName = "本示例") {
  const vars = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"];
  const model = appConfig?.model as
    | { apiKeyEnv?: string; authTokenEnv?: string }
    | undefined;
  if (model?.apiKeyEnv) vars.push(model.apiKeyEnv);
  if (model?.authTokenEnv) vars.push(model.authTokenEnv);

  if (!appConfig || !vars.some((v) => Boolean(process.env[v]))) {
    log.warn("无模型凭证 → 不降级 demo，直接报错");
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
