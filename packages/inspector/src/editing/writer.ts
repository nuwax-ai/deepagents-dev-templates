import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppConfig, TemplateRuntime } from "../template-runtime.js";
import {
  patchConfigSource,
  readConfigSource,
  serializeConfigSource,
  validateConfig,
  type FieldError,
} from "./config-source.js";
import type { FileDiff } from "./diff.js";
import { hashContent } from "./paths.js";
import { assertEditablePath, writeTextFileAtomic } from "./text-files.js";

export interface TextEdit {
  path: string;
  content: string;
  baseHash: string;
}

export interface EditPayload {
  config: Record<string, unknown>;
  /**
   * Optional baseline hash of the on-disk config. If provided and the disk
   * hash has changed since the spec was sent to the client, applyEdits
   * returns 409 to prevent clobbering concurrent edits. If omitted, no
   * check is performed (legacy clients).
   */
  configBaseHash?: string;
  text: TextEdit[];
}

export interface PreviewResult {
  files: FileDiff[];
  validation: { ok: true } | { ok: false; errors: FieldError[] };
}

export type ApplyResult =
  | { ok: true; written: string[] }
  | { ok: false; errors: Array<{ path?: string; message: string }> };

function buildConfigDiff(
  workspaceRoot: string,
  configPath: string,
  patch: Record<string, unknown>
): FileDiff | null {
  if (Object.keys(patch).length === 0) {
    return null;
  }
  const source = readConfigSource(workspaceRoot, configPath);
  const before = serializeConfigSource(source.raw);
  const after = serializeConfigSource(patchConfigSource(source.raw, patch));
  return { path: configPath, kind: "config", before, after };
}

function buildTextDiffs(workspaceRoot: string, config: AppConfig, edits: TextEdit[]): FileDiff[] {
  return edits.map((edit) => {
    assertEditablePath(workspaceRoot, config, edit.path);
    const abs = resolve(workspaceRoot, edit.path);
    const before = existsSync(abs) ? readFileSync(abs, "utf-8") : "";
    return { path: edit.path, kind: "text" as const, before, after: edit.content };
  });
}

export function previewEdits(
  runtime: TemplateRuntime,
  workspaceRoot: string,
  configPath: string,
  config: AppConfig,
  payload: EditPayload
): PreviewResult {
  const files: FileDiff[] = [];
  const configDiff = buildConfigDiff(workspaceRoot, configPath, payload.config);
  if (configDiff) {
    files.push(configDiff);
  }
  files.push(...buildTextDiffs(workspaceRoot, config, payload.text));

  const source = readConfigSource(workspaceRoot, configPath);
  const validation = validateConfig(runtime, patchConfigSource(source.raw, payload.config));
  return { files, validation };
}

export function applyEdits(
  runtime: TemplateRuntime,
  workspaceRoot: string,
  configPath: string,
  config: AppConfig,
  payload: EditPayload
): ApplyResult {
  // Gate 1: config validation
  const source = readConfigSource(workspaceRoot, configPath);
  const patched = patchConfigSource(source.raw, payload.config);
  const validation = validateConfig(runtime, patched);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  // Gate 2: optimistic concurrency for the config file (optional, opt-in via baseHash)
  if (payload.configBaseHash !== undefined) {
    const current = readConfigSource(workspaceRoot, configPath);
    if (current.hash !== payload.configBaseHash) {
      return {
        ok: false,
        errors: [
          {
            path: configPath,
            message: "Config file changed on disk; reload before applying.",
          },
        ],
      };
    }
  }

  // Gate 3: protected-zone guard (denylist from merged config)
  try {
    if (Object.keys(payload.config).length > 0) {
      assertEditablePath(workspaceRoot, config, configPath);
    }
    for (const edit of payload.text) {
      assertEditablePath(workspaceRoot, config, edit.path);
    }
  } catch (error) {
    return {
      ok: false,
      errors: [{ message: error instanceof Error ? error.message : String(error) }],
    };
  }

  // Gate 4: optimistic concurrency for text files
  for (const edit of payload.text) {
    const abs = resolve(workspaceRoot, edit.path);
    const current = existsSync(abs) ? readFileSync(abs, "utf-8") : "";
    if (hashContent(current) !== edit.baseHash) {
      return {
        ok: false,
        errors: [
          { path: edit.path, message: "File changed on disk; reload before applying." },
        ],
      };
    }
  }

  // Gate 5: atomic writes
  const written: string[] = [];
  if (Object.keys(payload.config).length > 0) {
    writeTextFileAtomic(workspaceRoot, config, configPath, serializeConfigSource(patched));
    written.push(configPath);
  }
  for (const edit of payload.text) {
    writeTextFileAtomic(workspaceRoot, config, edit.path, edit.content);
    written.push(edit.path);
  }
  return { ok: true, written };
}
