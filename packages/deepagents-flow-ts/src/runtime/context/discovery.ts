/**
 * Workspace Resource Discovery
 *
 * Discovers memory files (AGENTS.md / CLAUDE.md), normalizes skills directory
 * paths, and parses subagent definitions from `.agents/agents/` directories.
 * All resolution is workspace-root relative, matching how deepagents loads
 * these resources.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { type AppConfig } from "../config/config-loader.js";
import { logger } from "../logger.js";

// ─── Memory Files ───────────────────────────────────────

/**
 * Discover AGENTS.md and CLAUDE.md files in the workspace.
 * These are loaded by deepagents' memory system into the system prompt.
 */
export function discoverMemoryFiles(workspaceRoot: string, includeWorkspaceInstructions = true): string[] {
  if (!includeWorkspaceInstructions) {
    return [];
  }

  const candidates = [
    "AGENTS.md",
    "CLAUDE.md",
    ".deepagents/AGENTS.md",  // legacy path (backward compat)
    ".deepagents/agent.md",   // deepagents standard path
  ];
  const found: string[] = [];
  for (const candidate of candidates) {
    if (existsSync(resolve(workspaceRoot, candidate))) {
      found.push(`./${candidate}`);
    }
  }
  return found;
}

// ─── Skills Paths ───────────────────────────────────────

/**
 * Normalize skills directory paths for deepagents.
 * deepagents expects POSIX paths relative to the backend root.
 *
 * Includes:
 * 1. Built-in skill directories from config.skills.directories
 * 2. Skills from each configured agentsDirectory (via <dir>/skills/)
 */
export function resolveSkillsPaths(config: AppConfig): string[] {
  const paths = config.skills.directories.map(normalizeResourcePath);

  // Append skills from .agents directories
  for (const agentsDir of config.agentsDirectories) {
    const normalized = normalizeResourcePath(agentsDir);
    const skillsDir = `${normalized}/skills`;
    paths.push(skillsDir);
  }

  return Array.from(new Set(paths));
}

function normalizeResourcePath(path: string): string {
  if (path === "~/.deepagents") {
    return resolve(process.env.DEEPAGENTS_HOME || resolve(homedir(), ".deepagents"));
  }
  if (path.startsWith("~/.deepagents/")) {
    return resolve(process.env.DEEPAGENTS_HOME || resolve(homedir(), ".deepagents"), path.slice("~/.deepagents/".length));
  }
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  if (path.startsWith("/") || path.startsWith("./")) {
    return path;
  }
  return `./${path}`;
}

// ─── Subagent Discovery ─────────────────────────────────

/** Parsed subagent definition from an AGENT.md file */
export interface DiscoveredSubAgent {
  name: string;
  description: string;
  systemPrompt: string;
  /** 可选：覆盖模型名；可写 `model-name` 或 `provider/model-name`。frontmatter `model`。 */
  model?: string;
  /** 可选：工具名 allowlist（缺省继承父级全部工具，去掉 `task` 防递归）。frontmatter `tools`（逗号/空白分隔）。 */
  tools?: string[];
  /** 可选：相对工作目录（缺省 = 父 workspaceRoot，即启动 agent 的当前目录）。frontmatter `workdir`。 */
  workdir?: string;
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns { frontmatter, body } where frontmatter is a plain object.
 * Supports simple string values and multi-line values (continuation lines starting with whitespace).
 */
export function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  let frontmatter: Record<string, string> = {};
  try {
    const parsed = parseYaml(match[1]) as Record<string, unknown> | null;
    if (parsed && typeof parsed === "object") {
      frontmatter = {};
      for (const [key, value] of Object.entries(parsed)) {
        frontmatter[key] = typeof value === "string" ? value : String(value ?? "");
      }
    }
  } catch {
    // YAML parse error — return empty frontmatter, keep body intact
  }

  return { frontmatter, body: match[2]!.trim() };
}

/**
 * Discover subagents from configured .agents/agents/ directories.
 *
 * Convention: each subagent is a subdirectory containing an AGENT.md file
 * with YAML frontmatter (name, description) and a body (systemPrompt).
 *
 * @example
 * .agents/agents/researcher/AGENT.md:
 *   ---
 *   name: researcher
 *   description: "Deep research assistant"
 *   ---
 *   You are a research assistant specialized in...
 */
export function discoverSubAgents(config: AppConfig, workspaceRoot?: string): DiscoveredSubAgent[] {
  const subagents: DiscoveredSubAgent[] = [];
  const log = logger.child("subagent-discovery");
  const root = workspaceRoot || process.cwd();

  for (const agentsDir of config.agentsDirectories) {
    const normalized = normalizeResourcePath(agentsDir);
    const agentsPath = resolve(root, normalized, "agents");

    if (!existsSync(agentsPath)) {
      log.debug("No agents/ directory found", { path: agentsPath });
      continue;
    }

    let entries: string[];
    try {
      entries = readdirSync(agentsPath, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      log.warn("Failed to read agents directory", { path: agentsPath });
      continue;
    }

    for (const entry of entries) {
      const agentMdPath = join(agentsPath, entry, "AGENT.md");
      if (!existsSync(agentMdPath)) {
        log.debug("No AGENT.md found in agent directory", { dir: entry });
        continue;
      }

      try {
        const content = readFileSync(agentMdPath, "utf-8");
        const { frontmatter, body } = parseFrontmatter(content);

        const name = frontmatter.name || entry;
        const description = frontmatter.description || `Subagent: ${name}`;

        if (!body) {
          log.warn("AGENT.md has no body (systemPrompt)", { path: agentMdPath });
          continue;
        }

        const model = frontmatter.model || undefined;
        const workdir = frontmatter.workdir || undefined;
        const tools = frontmatter.tools
          ? frontmatter.tools.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean)
          : undefined;

        subagents.push({ name, description, systemPrompt: body, model, tools, workdir });
        log.info("Discovered subagent", { name, source: agentMdPath });
      } catch (err) {
        log.warn("Failed to parse AGENT.md", {
          path: agentMdPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return subagents;
}

// ─── Skill Discovery ────────────────────────────────────

/** Parsed skill manifest from a SKILL.md file (frontmatter only; body loaded on demand). */
export interface DiscoveredSkill {
  name: string;
  description: string;
  /** SKILL.md 绝对路径（`load_skill` 工具读正文用）。 */
  path: string;
}

/**
 * Discover skills from every directory in `resolveSkillsPaths(config)`.
 *
 * Convention: each skill is a subdirectory containing a SKILL.md with YAML
 * frontmatter (name, description) and a body (full instructions). Only the
 * frontmatter is parsed here — the body is loaded on demand via `load_skill`
 * (progressive disclosure, deepagents-style). First occurrence of a name wins
 * (matches `resolveSkillsPaths` precedence order).
 */
export function discoverSkills(config: AppConfig, workspaceRoot?: string): DiscoveredSkill[] {
  const log = logger.child("skill-discovery");
  const root = workspaceRoot || process.cwd();
  const skills: DiscoveredSkill[] = [];
  const seen = new Set<string>();

  for (const dirPath of resolveSkillsPaths(config)) {
    const skillsDir = resolve(root, dirPath);
    if (!existsSync(skillsDir)) {
      log.debug("No skills directory found", { path: skillsDir });
      continue;
    }

    let entries: string[];
    try {
      entries = readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      log.warn("Failed to read skills directory", { path: skillsDir });
      continue;
    }

    for (const entry of entries) {
      const skillMd = join(skillsDir, entry, "SKILL.md");
      if (!existsSync(skillMd)) continue;
      try {
        const { frontmatter } = parseFrontmatter(readFileSync(skillMd, "utf-8"));
        const name = frontmatter.name || entry;
        if (seen.has(name)) continue;
        seen.add(name);
        skills.push({
          name,
          description: frontmatter.description || `Skill: ${name}`,
          path: skillMd,
        });
        log.debug("Discovered skill", { name, source: skillMd });
      } catch (err) {
        log.warn("Failed to parse SKILL.md", {
          path: skillMd,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return skills;
}

// ─── Prompt Section Renderers ───────────────────────────

/**
 * Render the "Available Skills" prompt section (name + description only).
 * Empty when no skills — caller appends to the system prompt.
 */
export function renderSkillsSection(skills: DiscoveredSkill[], progressiveLoading = true): string {
  if (!skills.length) return "";
  if (!progressiveLoading) {
    const blocks = skills.map((s) => {
      try {
        const { body } = parseFrontmatter(readFileSync(s.path, "utf-8"));
        return `### ${s.name}\n${body}`;
      } catch (err) {
        return `### ${s.name}\n读取失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    });
    return `## Available Skills

以下 skill 已完整加载到系统提示词中，直接按对应说明执行：
${blocks.join("\n\n")}`;
  }
  const lines = skills.map((s) => `- **${s.name}** — ${s.description}`);
  return `## Available Skills

需要专门流程/知识时，先调用 \`load_skill(name)\` 读取该 skill 的完整说明（SKILL.md 正文），再据此执行：
${lines.join("\n")}`;
}

/**
 * Render the "Subagents" prompt section. Empty when no subagents.
 * Tells the model it can delegate via the `task` tool.
 */
export function renderSubagentsSection(subAgents: DiscoveredSubAgent[]): string {
  if (!subAgents.length) return "";
  const lines = subAgents.map((a) => `- **${a.name}** — ${a.description}`);
  return `## Subagents（用 task 委派）

需要专门能力时，调用 \`task({ subagent_type, description })\` 把子任务委派给下列子代理（各自独立 prompt/工具/工作目录），拿回结果后继续：
${lines.join("\n")}`;
}
