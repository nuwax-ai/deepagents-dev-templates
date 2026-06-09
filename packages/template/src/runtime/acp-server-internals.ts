/**
 * deepagents-acp Private-Internals Adapter
 *
 * `deepagents-acp`'s `DeepAgentsServer` does not (yet) expose stable lifecycle
 * hooks, so the ACP surface reaches into private members (`agentConfigs`,
 * `sessions`, `agents`, `acpBackends`, `handle*`). This module is the SINGLE
 * place that access is allowed — every reach-through in `surfaces/acp/server.ts`
 * goes through `getDeepAgentsServerInternals()` / `bindInternalHandler()`, which
 * fail fast with a clear error if upstream renames or removes a member.
 *
 * There is a SECOND, related workaround living in
 * `runtime/middleware/protected-paths.ts`: `DeepAgentsServer.createAgent()` calls
 * `createDeepAgent({...})` without our `permissions` field, dropping deny rules
 * at the bridge — so write protection is enforced by a middleware that wraps
 * `write_file` / `edit_file` instead of relying on the `permissions` array.
 *
 * When upstream ships stable hooks, retire both workarounds together.
 */

import type { DeepAgentConfig } from "deepagents-acp";

export interface AcpSessionState {
  id: string;
  agentName: string;
  mode?: string;
}

export interface DeepAgentsServerInternals {
  handleNewSession?: (...args: unknown[]) => Promise<unknown>;
  handleLoadSession?: (...args: unknown[]) => Promise<unknown>;
  handlePrompt?: (...args: unknown[]) => Promise<unknown>;
  handleCancel?: (...args: unknown[]) => Promise<unknown>;
  handleSetSessionMode?: (...args: unknown[]) => Promise<unknown>;
  handleCloseSession?: (...args: unknown[]) => Promise<unknown>;
  handleListSessions?: (...args: unknown[]) => Promise<unknown>;
  sessions: Map<string, AcpSessionState & Record<string, unknown>>;
  agentConfigs: Map<string, DeepAgentConfig>;
  agents: Map<string, unknown>;
  acpBackends: Map<string, { setSessionId?: (sessionId: string) => void }>;
  workspaceRoot?: string;
  createAgent?: (agentName: string) => void;
}

export type DeepAgentsServerInternalsFeature =
  | "agent-configs"
  | "sessions"
  | "agents"
  | "acp-backends";

export class DeepAgentsServerInternalsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepAgentsServerInternalsError";
  }
}

export function getDeepAgentsServerInternals(
  server: unknown,
  features: DeepAgentsServerInternalsFeature[] = ["agent-configs", "sessions"]
): DeepAgentsServerInternals {
  const candidate = server as Partial<DeepAgentsServerInternals>;
  const missing: string[] = [];

  if (features.includes("agent-configs") && !(candidate.agentConfigs instanceof Map)) {
    missing.push("agentConfigs");
  }
  if (features.includes("sessions") && !(candidate.sessions instanceof Map)) {
    missing.push("sessions");
  }
  if (features.includes("agents") && !(candidate.agents instanceof Map)) {
    missing.push("agents");
  }
  if (features.includes("acp-backends") && !(candidate.acpBackends instanceof Map)) {
    missing.push("acpBackends");
  }

  if (missing.length > 0) {
    throw new DeepAgentsServerInternalsError(
      `Unsupported deepagents-acp server internals; missing ${missing.join(", ")}. ` +
        "Update the ACP adapter or use an upstream-supported lifecycle hook."
    );
  }

  return candidate as DeepAgentsServerInternals;
}

export function bindInternalHandler<T extends (...args: unknown[]) => Promise<unknown>>(
  server: unknown,
  handler: T | undefined
): T | undefined {
  return handler ? (handler.bind(server) as T) : undefined;
}

