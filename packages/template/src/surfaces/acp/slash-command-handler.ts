/**
 * ACP Slash-Command Handling
 *
 * Intercepts `/...` prompts before they reach the LLM, runs them through the
 * shared slash-command registry, and streams any text result back to the ACP
 * client. Also holds the small ACP message shapes shared with the lifecycle
 * patch.
 */

import { type AppConfig } from "@runtime/config/config-loader.js";
import { type DeepAgentsServerInternals } from "@runtime/acp-server-internals.js";
import { executeSlashCommand, type SlashToolInfo } from "@runtime/slash-commands.js";
import { appendRuntimeMessage, getRuntimeStorage } from "@runtime/storage/runtime-storage.js";

export interface AcpPromptBlock {
  type?: string;
  text?: string;
}

export interface AcpPromptParams {
  sessionId: string;
  prompt: AcpPromptBlock[];
}

export interface AcpConnection {
  sessionUpdate(params: {
    sessionId: string;
    update: {
      sessionUpdate: "agent_message_chunk";
      content: {
        type: "text";
        text: string;
      };
    };
  }): Promise<void>;
}

export async function handleAcpSlashCommand(options: {
  server: DeepAgentsServerInternals;
  params: AcpPromptParams;
  conn?: AcpConnection;
  config: AppConfig;
  workspaceRoot: string;
}): Promise<{ stopReason: "end_turn" } | null> {
  const text = getAcpPromptText(options.params.prompt);
  if (!text?.startsWith("/")) {
    return null;
  }

  const session = options.server.sessions.get(options.params.sessionId);
  const agentConfig = session
    ? options.server.agentConfigs.get(session.agentName)
    : undefined;

  const result = executeSlashCommand(text, {
    environment: "acp",
    tools: toSlashToolInfo(agentConfig?.tools),
    config: options.config,
    workspaceRoot: options.workspaceRoot,
    mode: session?.mode,
    sessionId: session?.id,
  });

  if (!result) {
    return null;
  }

  if (result.text && options.conn) {
    await sendAcpText(options.params.sessionId, options.conn, result.text);
    appendRuntimeMessage(
      { role: "assistant", content: result.text },
      getRuntimeStorage({ workspaceRoot: options.workspaceRoot, sessionId: options.params.sessionId })
    );
  }

  return { stopReason: "end_turn" };
}

export function getAcpPromptText(prompt: AcpPromptBlock[]): string | null {
  const block = prompt.find((candidate) => candidate.type === "text" && candidate.text);
  return block?.text?.trim() ?? null;
}

function toSlashToolInfo(tools: unknown): SlashToolInfo[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  const result: SlashToolInfo[] = [];
  for (const tool of tools) {
    const candidate = tool as { name?: unknown; description?: unknown };
    if (typeof candidate.name !== "string") {
      continue;
    }

    const info: SlashToolInfo = { name: candidate.name };
    if (typeof candidate.description === "string") {
      info.description = candidate.description;
    }
    result.push(info);
  }

  return result;
}

async function sendAcpText(
  sessionId: string,
  conn: AcpConnection,
  text: string
): Promise<void> {
  await conn.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: {
        type: "text",
        text,
      },
    },
  });
}
