/**
 * ACP Slash-Command Handling
 *
 * Runs `/...` prompts through the shared slash-command registry and streams any
 * text result back to the ACP client. Invoked from the `onPrompt` lifecycle hook
 * (see `session-lifecycle.ts`); it takes a plain options bag and no longer
 * reaches into DeepAgentsServer internals.
 */

import { type AppConfig } from "../../runtime/config/config-loader.js";
import { executeSlashCommand, type SlashToolInfo } from "../../runtime/slash-commands.js";
import { appendRuntimeMessage, getRuntimeStorage } from "../../runtime/storage/runtime-storage.js";

export interface AcpPromptBlock {
  type?: string;
  text?: string;
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

/**
 * Handle a possible slash command. Returns a stop reason when the prompt was a
 * recognized slash command (so the turn is short-circuited), or `null` to let
 * the agent run normally.
 */
export async function handleAcpSlashCommand(options: {
  promptText: string | null;
  conn?: AcpConnection;
  config: AppConfig;
  workspaceRoot: string;
  mode?: string;
  sessionId: string;
  tools?: unknown;
}): Promise<{ stopReason: "end_turn" } | null> {
  const text = options.promptText;
  if (!text?.startsWith("/")) {
    return null;
  }

  const result = executeSlashCommand(text, {
    environment: "acp",
    tools: toSlashToolInfo(options.tools),
    config: options.config,
    workspaceRoot: options.workspaceRoot,
    mode: options.mode,
    sessionId: options.sessionId,
  });

  if (!result) {
    return null;
  }

  if (result.text && options.conn) {
    await sendAcpText(options.sessionId, options.conn, result.text);
    appendRuntimeMessage(
      { role: "assistant", content: result.text },
      getRuntimeStorage({ workspaceRoot: options.workspaceRoot, sessionId: options.sessionId })
    );
  }

  return { stopReason: "end_turn" };
}

/** Extract the trimmed text of the first text block in an ACP prompt. */
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
