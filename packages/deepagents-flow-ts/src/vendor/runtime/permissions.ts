/**
 * Sandbox Policy & Filesystem Permissions
 *
 * Resolves the effective sandbox policy from config/profile and builds the
 * deepagents `FilesystemPermission[]` deny/allow rules. Deny entries are emitted
 * as both OS-absolute and workspace-relative globs so deepagents' built-in
 * FilesystemMiddleware enforces them regardless of the path form the model uses.
 */

import { join } from "node:path";
import { type FilesystemPermission } from "deepagents";
import { type AppConfig } from "./config/config-loader.js";

export interface SandboxPolicy {
  profile: "custom" | "workspace-write" | "read-only" | "open";
  deniedWritePaths: string[];
  writablePaths: string[];
  allowedEnv: string[];
  secretEnv: string[];
}

export function resolveSandboxPolicy(config: AppConfig): SandboxPolicy {
  const sandbox = config.sandbox;
  if (!sandbox || sandbox.profile === "custom") {
    return {
      profile: "custom",
      deniedWritePaths: config.permissions.deniedPaths,
      writablePaths: config.permissions.allowedPaths,
      allowedEnv: sandbox?.environment.allowedEnv ?? [],
      secretEnv: sandbox?.environment.secretEnv ?? [],
    };
  }

  if (sandbox.profile === "open") {
    return {
      profile: "open",
      deniedWritePaths: [],
      writablePaths: ["/**"],
      allowedEnv: sandbox.environment.allowedEnv,
      secretEnv: sandbox.environment.secretEnv,
    };
  }

  if (sandbox.profile === "read-only") {
    return {
      profile: "read-only",
      deniedWritePaths: ["/"],
      writablePaths: [],
      allowedEnv: sandbox.environment.allowedEnv,
      secretEnv: sandbox.environment.secretEnv,
    };
  }

  return {
    profile: "workspace-write",
    deniedWritePaths: sandbox.deniedWritePaths,
    writablePaths: sandbox.writablePaths,
    allowedEnv: sandbox.environment.allowedEnv,
    secretEnv: sandbox.environment.secretEnv,
  };
}

/**
 * Convert a single denied-write path (workspace-relative or absolute) into
 * the OS-absolute glob that deepagents' FilesystemMiddleware (decidePathAccess)
 * matches against the `file_path` the tool receives.
 *
 * Examples (with workspaceRoot = "/Users/dev/project"):
 *   "src/runtime/"     → "/Users/dev/project/src/runtime/**"
 *   "src/runtime"      → "/Users/dev/project/src/runtime/**"
 *   "/abs/dir/"        → "/abs/dir/**"
 *   "/"                → "/**"
 *
 * `join()` is used (not `resolve()`) so the trailing slash on a directory is
 * preserved — `/abs/dir/**` (correct) vs `/abs/dir**` (would also match
 * `/abs/dirfoo/x.ts`).
 */
export function toAbsoluteDenyGlob(denied: string, workspaceRoot: string): string {
  const withSlash = denied.endsWith("/") ? denied : `${denied}/`;
  const absoluteBase = withSlash.startsWith("/")
    ? withSlash
    : join(workspaceRoot, withSlash);        // join preserves trailing `/`
  return absoluteBase.startsWith("/") ? `${absoluteBase}**` : `/${absoluteBase}**`;
}

/**
 * Workspace-relative ("virtual") absolute deny glob — the path form the model
 * uses when addressing files relative to the backend root (e.g. "/src/x.ts").
 * Pairs with `toAbsoluteDenyGlob` so deny rules match whether deepagents'
 * FilesystemMiddleware receives an OS-absolute or backend-relative path.
 */
export function toWorkspaceDenyGlob(denied: string): string {
  const trimmed = denied.startsWith("/") ? denied : `/${denied}`;
  const withSlash = trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
  return `${withSlash}**`;
}

/**
 * Build filesystem permissions for deepagents.
 *
 * Protects denied paths from writes while allowing everything else. The
 * deepagents `decidePathAccess` rule evaluator uses micromatch globs against
 * the literal `file_path` string the tool receives — which in our setup is an
 * OS-absolute path like `/Users/foo/project/src/runtime/x.ts`, not the
 * backend-rooted path `/src/runtime/x.ts`. So we resolve each denied entry
 * against the workspace root to produce an absolute glob before adding the
 * deny rule. Without this resolution, the deny glob never matches the actual
 * file path the agent passes and the deny is silently ignored.
 */
export function buildPermissions(config: AppConfig, workspaceRoot?: string): FilesystemPermission[] {
  const permissions: FilesystemPermission[] = [];
  const sandbox = resolveSandboxPolicy(config);
  const root = workspaceRoot ?? "/";

  for (const denied of sandbox.deniedWritePaths) {
    // Emit BOTH an OS-absolute glob and a workspace-relative ("virtual")
    // absolute glob. deepagents' FilesystemMiddleware matches the literal path
    // the model passes to the tool, which may be either form. Covering both
    // keeps the deny robust now that the custom protected-paths middleware
    // (which normalized paths itself) has been removed. Dedup so absolute
    // inputs (where both globs coincide) yield a single pattern.
    const denyGlobs = Array.from(
      new Set([toAbsoluteDenyGlob(denied, root), toWorkspaceDenyGlob(denied)])
    );
    permissions.push({
      operations: ["write"],
      paths: denyGlobs,
      mode: "deny" as const,
    });
  }

  permissions.push({
    operations: ["read", "write"],
    paths: ["/**"],
    mode: "allow" as const,
  });

  return permissions;
}

/**
 * Build the interruptOn map for deepagents from the config array.
 * Maps tool names to `true` for human-in-the-loop approval.
 */
export function buildInterruptOn(tools: string[]): Record<string, boolean> {
  const interruptOn: Record<string, boolean> = {};
  for (const toolName of tools) {
    interruptOn[toolName] = true;
  }
  return interruptOn;
}
