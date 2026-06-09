/**
 * Slash Command Definitions
 *
 * All slash command definitions in the COMMANDS array.
 * To add a new slash command, add an entry here.
 */

import { migrateLegacyState } from "../storage/runtime-storage.js";
import { renderHelp, renderTools, renderConfig, renderStatus, renderSessions, renderSession, renderPlan, renderHistory, renderMemory, renderCheckpoints, renderApprovals } from "./rendering.js";
import type { SlashCommandDefinition } from "./types.js";

export type {
  SlashEnvironment,
  SlashToolInfo,
  SlashCommandConfig,
  SlashCommandContext,
  SlashCommandResult,
  ParsedSlashCommand,
  SlashCommandDefinition,
} from "./types.js";

export { ACP_BUILTIN_COMMANDS, ACP_DEFAULT_COMMAND_NAMES } from "./types.js";

export const COMMANDS: SlashCommandDefinition[] = [
  {
    name: "help",
    aliases: ["?"],
    description: "显示可用 slash commands",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderHelp(ctx.environment),
    }),
  },
  {
    name: "tools",
    description: "列出当前 Agent 可用工具",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderTools(ctx.tools),
    }),
  },
  {
    name: "config",
    description: "显示当前配置摘要",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderConfig(ctx),
    }),
  },
  {
    name: "status",
    description: "显示当前会话状态",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderStatus(ctx),
    }),
  },
  {
    name: "sessions",
    description: "列出当前工作区历史会话",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderSessions(ctx),
    }),
  },
  {
    name: "session",
    description: "显示当前或指定会话存储信息",
    environments: ["cli", "acp"],
    inputHint: "[sessionId]",
    execute: (ctx, parsed) => ({
      kind: "handled",
      text: renderSession(ctx, parsed.arg || undefined),
    }),
  },
  {
    name: "plan",
    description: "查看当前会话 plan.md",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderPlan(ctx),
    }),
  },
  {
    name: "history",
    description: "查看当前会话消息历史",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderHistory(ctx),
    }),
  },
  {
    name: "memory",
    description: "查看当前 agent memory 路径和摘要",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderMemory(ctx),
    }),
  },
  {
    name: "checkpoints",
    description: "列出当前会话 checkpoints",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderCheckpoints(ctx),
    }),
  },
  {
    name: "migrate-state",
    description: "迁移旧 .agent-memory 和 .agent-checkpoints 到 ~/.deepagents",
    environments: ["cli", "acp"],
    execute: (ctx) => {
      const result = migrateLegacyState(ctx.workspaceRoot, ctx.sessionId);
      return {
        kind: "handled",
        text: [
          "Legacy state 迁移完成:",
          `  Memory files: ${result.memoryFiles}`,
          `  Checkpoints:   ${result.checkpoints}`,
          `  Target:        ${result.target}`,
          "旧目录不会自动删除。",
        ].join("\n"),
      };
    },
  },
  {
    name: "approvals",
    description: "查看当前 workspace 的用户级审批记录",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderApprovals(ctx),
    }),
  },
  {
    name: "permissions",
    aliases: ["pmode", "perm"],
    description: "切换 deepagents 权限 mode (yolo|plan|ask)，仅影响新 session",
    environments: ["cli", "acp"],
    inputHint: "<yolo|plan|ask>",
    execute: (_ctx, parsed) => {
      const arg = parsed.arg.trim().toLowerCase();
      const valid = ["yolo", "plan", "ask"];
      if (!arg) {
        const current = process.env.DEEPAGENTS_PERMISSIONS_MODE || "(unset → uses config default)";
        return {
          kind: "handled",
          text: [
            "Deepagents 权限 mode:",
            `  当前 env:  ${current}`,
            `  config 默认: ${arg || "(见 app-agent.config.json)"}`,
            "",
            "用法: /permissions yolo|plan|ask",
            "说明: 改 env 变量只对新建的 session 生效 — 当前 session 的 mode 在 agent 启动时已 baked-in。",
            "       要应用新 mode, 需开新 session（或重启 agent server）。",
          ].join("\n"),
        };
      }
      if (!valid.includes(arg)) {
        return {
          kind: "handled",
          text: `无效 mode: '${parsed.arg}'。可选: ${valid.join(", ")}`,
        };
      }
      process.env.DEEPAGENTS_PERMISSIONS_MODE = arg;
      return {
        kind: "handled",
        text: [
          `Deepagents 权限 mode 已设为: ${arg}`,
          "",
          "影响范围: 仅新建的 session。当前 session 的 mode 仍为启动时的值。",
          "下一步: 在 Zed 中 disconnect 当前 session, 然后新建一个（或重启 agent server）。",
        ].join("\n"),
      };
    },
  },
  {
    name: "clear",
    description: "清屏",
    environments: ["cli"],
    execute: (ctx) => {
      ctx.clearScreen?.();
      return { kind: "handled" };
    },
  },
  {
    name: "save",
    description: "保存 CLI 对话历史到 JSON 文件",
    environments: ["cli"],
    inputHint: "<path>",
    execute: (ctx, parsed) => {
      if (!parsed.arg) {
        return {
          kind: "handled",
          text: "Error: /save requires a file path",
        };
      }
      ctx.saveHistory?.(parsed.arg);
      return { kind: "handled" };
    },
  },
  {
    name: "exit",
    aliases: ["quit"],
    description: "退出 CLI REPL",
    environments: ["cli"],
    execute: () => ({ kind: "exit" }),
  },
];
