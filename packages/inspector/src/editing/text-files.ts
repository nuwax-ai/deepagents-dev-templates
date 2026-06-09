import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { AppConfig } from "../template-runtime.js";
import { hashContent } from "./paths.js";

/**
 * Hard path guard for any file the inspector reads or writes. Throws on:
 *  - absolute paths
 *  - paths that escape `workspaceRoot` (including `..` segments and cross-drive on Windows)
 *  - paths that resolve under any entry in `config.permissions.deniedPaths`
 *
 * The denylist mirrors how the agent itself protects `src/runtime` and
 * `src/surfaces`. Users can extend it by editing `permissions.deniedPaths`
 * in `app-agent.config.json`; the inspector will pick up the new entries
 * on the next server reload.
 */
export function assertEditablePath(workspaceRoot: string, config: AppConfig, relPath: string): void {
  if (isAbsolute(relPath)) {
    throw new Error(`Refusing absolute path: ${relPath}`);
  }
  const abs = resolve(workspaceRoot, relPath);
  const rel = relative(workspaceRoot, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`Path escapes workspace: ${relPath}`);
  }

  const denied = config?.permissions?.deniedPaths ?? [];
  for (const deniedPath of denied) {
    if (typeof deniedPath !== "string" || deniedPath.length === 0) continue;
    const deniedAbs = resolve(workspaceRoot, deniedPath);
    if (abs === deniedAbs) {
      throw new Error(`Path is denied by permissions.deniedPaths: ${relPath}`);
    }
    const deniedDir = deniedAbs.endsWith(sep) ? deniedAbs : deniedAbs + sep;
    if (abs.startsWith(deniedDir)) {
      throw new Error(`Path is under a denied directory (${deniedPath}): ${relPath}`);
    }
  }
}

/**
 * Soft hint for the UI: does this path fall under any `permissions.allowedPaths`?
 * Does not gate; only used to display a badge in the editing panel.
 */
export function isInAllowedPath(workspaceRoot: string, config: AppConfig, relPath: string): boolean {
  const allowed = config?.permissions?.allowedPaths ?? [];
  const abs = resolve(workspaceRoot, relPath);
  for (const allowedPath of allowed) {
    if (typeof allowedPath !== "string" || allowedPath.length === 0) continue;
    const allowedAbs = resolve(workspaceRoot, allowedPath);
    if (abs === allowedAbs) return true;
    const allowedDir = allowedAbs.endsWith(sep) ? allowedAbs : allowedAbs + sep;
    if (abs.startsWith(allowedDir)) return true;
  }
  return false;
}

export interface ReadFile {
  content: string;
  hash: string;
}

export function readTextFile(workspaceRoot: string, config: AppConfig, relPath: string): ReadFile | null {
  assertEditablePath(workspaceRoot, config, relPath);
  const abs = resolve(workspaceRoot, relPath);
  if (!existsSync(abs)) {
    return null;
  }
  const content = readFileSync(abs, "utf-8");
  return { content, hash: hashContent(content) };
}

export function writeTextFileAtomic(workspaceRoot: string, config: AppConfig, relPath: string, content: string): void {
  assertEditablePath(workspaceRoot, config, relPath);
  const abs = resolve(workspaceRoot, relPath);
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, abs);
}
