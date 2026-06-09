/**
 * Slash Commands — Re-export Barrel
 *
 * Public API remains identical: executeSlashCommand, getAcpSlashCommandSpecs,
 * and all exported types.
 */

export {
  executeSlashCommand,
  getAcpSlashCommandSpecs,
} from "./slash-commands/execution.js";

export type {
  SlashEnvironment,
  SlashToolInfo,
  SlashCommandConfig,
  SlashCommandContext,
  SlashCommandResult,
} from "./slash-commands/types.js";
