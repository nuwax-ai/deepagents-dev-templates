import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TemplateRuntime } from "../template-runtime.js";
import { hashContent, setByPath } from "./paths.js";

type Obj = Record<string, unknown>;

export interface ConfigSource {
  raw: Obj;
  hash: string;
}

export function readConfigSource(workspaceRoot: string, configPath: string): ConfigSource {
  const abs = resolve(workspaceRoot, configPath);
  if (!existsSync(abs)) {
    return { raw: {}, hash: hashContent("") };
  }
  const text = readFileSync(abs, "utf-8");
  return { raw: JSON.parse(text) as Obj, hash: hashContent(text) };
}

export function patchConfigSource(raw: Obj, patch: Record<string, unknown>): Obj {
  let next = raw;
  for (const [path, value] of Object.entries(patch)) {
    next = setByPath(next, path, value);
  }
  return next;
}

export interface FieldError {
  path: string;
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; errors: FieldError[] };

export function validateConfig(runtime: TemplateRuntime, candidate: Obj): ValidationResult {
  const result = runtime.AppConfigSchema.safeParse(candidate);
  if (result.success) {
    return { ok: true };
  }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export function serializeConfigSource(raw: Obj): string {
  return `${JSON.stringify(raw, null, 2)}\n`;
}
