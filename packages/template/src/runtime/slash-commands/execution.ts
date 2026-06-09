/**
 * Slash Command Execution & Parsing
 *
 * Command dispatch, parsing logic, and ACP spec generation.
 */

import { ACP_DEFAULT_COMMAND_NAMES } from "./types.js";
import type { SlashCommandContext, SlashCommandResult, ParsedSlashCommand, SlashCommandDefinition } from "./types.js";
import { COMMANDS } from "./definitions.js";
import { renderHelp } from "./rendering.js";

export function executeSlashCommand(
  input: string,
  ctx: SlashCommandContext
): SlashCommandResult | null {
  const parsed = parseSlashCommand(input);
  if (!parsed) {
    return null;
  }

  const command = COMMANDS.find((candidate) =>
    commandMatches(candidate, parsed.name) &&
    candidate.environments.includes(ctx.environment)
  );

  if (!command) {
    if (ctx.environment === "acp") {
      return null;
    }
    return {
      kind: "handled",
      text: `Unknown command: /${parsed.name}\n\n${renderHelp(ctx.environment, COMMANDS)}`,
    };
  }

  return command.execute(ctx, parsed);
}

export function getAcpSlashCommandSpecs(): Array<{
  name: string;
  description: string;
  input?: { hint: string };
}> {
  return COMMANDS
    .filter((command) => command.environments.includes("acp"))
    .filter((command) => !ACP_DEFAULT_COMMAND_NAMES.has(command.name))
    .map((command) => ({
      name: command.name,
      description: command.description,
      ...(command.inputHint ? { input: { hint: command.inputHint } } : {}),
    }));
}

/**
 * 判断以 `/` 开头的输入是否更像文件系统路径，而非 slash command。
 *
 * 模板命令名均为单词（help、config、session）；绝对路径含 `/` 分隔符
 * （如 `/Users/apple/proj/src`）。若误判为命令，ACP 会把路径当 prompt 拦截。
 *
 * 注意：Zed 等客户端可能在消息到达 agent 前就拦截 `/` 前缀输入；
 * 此处逻辑主要保证到达 runtime 后走正常 LLM prompt，并覆盖 CLI REPL。
 */
function looksLikeFilesystemPath(body: string): boolean {
  const firstToken = body.split(/\s+/)[0] ?? "";
  if (!firstToken) {
    return false;
  }
  // 命令名不会含路径分隔符；`/Users/...` 整段通常是一个 token
  if (firstToken.includes("/")) {
    return true;
  }
  // 常见绝对路径根（无后续 `/` 的少见，如 `/tmp` 单独出现）
  return /^(?:users|home|tmp|var|opt|private|volumes|etc|usr|workspace)(?:\/|$)/i.test(firstToken);
}

function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const body = trimmed.slice(1);
  if (looksLikeFilesystemPath(body)) {
    return null;
  }

  const [rawName = "", ...args] = body.split(/\s+/);
  const name = rawName.toLowerCase();
  if (!name) {
    return null;
  }

  return {
    name,
    arg: args.join(" "),
  };
}

function commandMatches(command: SlashCommandDefinition, name: string): boolean {
  return command.name === name || command.aliases?.includes(name) === true;
}
