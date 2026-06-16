/**
 * Config path resolution.
 *
 * Filesystem locations for the template package, the user's ~/.deepagents home,
 * and the built-in template config presets. Pure path logic — no config parsing
 * or merging. Extracted from config-loader.ts.
 */
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";
import {
  BUILTIN_TEMPLATE_CONFIGS,
  DEFAULT_BUILTIN_TEMPLATE_CONFIG,
  type BuiltinTemplateConfigName,
} from "./config-schema.js";

// NOTE: this file must stay in src/runtime/config/ — TEMPLATE_PACKAGE_ROOT is
// derived from import.meta.url relative to this location.
const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_PACKAGE_ROOT = resolve(RUNTIME_DIR, "..", "..", "..");

export function readBuiltinTemplateConfigNameFromEnv(): BuiltinTemplateConfigName | undefined {
  const name = process.env.DEEPAGENTS_BUILTIN_CONFIG;
  if (!name) {
    return undefined;
  }
  if (name in BUILTIN_TEMPLATE_CONFIGS) {
    return name as BuiltinTemplateConfigName;
  }
  logger.warn("Unknown DEEPAGENTS_BUILTIN_CONFIG; falling back to default", {
    requested: name,
    available: Object.keys(BUILTIN_TEMPLATE_CONFIGS),
  });
  return undefined;
}

export function resolveBuiltinTemplateConfig(
  name: BuiltinTemplateConfigName = DEFAULT_BUILTIN_TEMPLATE_CONFIG
): { path: string; resourceBase: string } {
  const config = BUILTIN_TEMPLATE_CONFIGS[name];
  return {
    path: resolve(TEMPLATE_PACKAGE_ROOT, config.path),
    resourceBase: resolve(TEMPLATE_PACKAGE_ROOT, config.resourceBase),
  };
}

export function deepAgentsHome(): string {
  return resolve(process.env.DEEPAGENTS_HOME || join(homedir(), ".deepagents"));
}

export function resolveConfigResourcePath(path: string, baseDir: string): string {
  if (path.startsWith("~/") || path.startsWith("~/.deepagents/") || isAbsolute(path)) {
    return path;
  }
  return resolve(baseDir, path);
}

export function resolvePath(filePath: string, baseDir = process.cwd()): string {
  if (filePath === "~/.deepagents") {
    return deepAgentsHome();
  }
  if (filePath.startsWith("~/.deepagents/")) {
    return resolve(deepAgentsHome(), filePath.slice("~/.deepagents/".length));
  }
  if (filePath.startsWith("~/")) {
    return resolve(homedir(), filePath.slice(2));
  }
  if (isAbsolute(filePath)) {
    return filePath;
  }
  return resolve(baseDir, filePath);
}
