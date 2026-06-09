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
import { type AppConfig } from "./config/config-loader.js";
import { logger } from "./logger.js";

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
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns { frontmatter, body } where frontmatter is a plain object.
 * Supports simple string values and multi-line values (continuation lines starting with whitespace).
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
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

        subagents.push({ name, description, systemPrompt: body });
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
