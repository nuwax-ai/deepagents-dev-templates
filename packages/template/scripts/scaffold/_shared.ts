/**
 * Shared helpers for the scaffold scripts (new:tool / new:skill / new:prompt).
 * Pure Node + tsx; no external deps.
 */
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** packages/template root (scripts/scaffold/ -> ../../) */
export const PKG_ROOT = resolve(__dirname, "../..");

const NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Read the scaffold target name from argv and validate it as kebab-case. */
export function parseName(kind: string, example: string): string {
  const raw = process.argv.slice(2).find((a) => !a.startsWith("-"));
  if (!raw) {
    fail(
      `Missing <name>.\n\n  Usage:   npm run new:${kind} -- <name>\n  Example: npm run new:${kind} -- ${example}`
    );
  }
  if (!NAME_RE.test(raw)) {
    fail(`Invalid name "${raw}". Use kebab-case (lowercase, digits, hyphens), e.g. "${example}".`);
  }
  return raw;
}

/** Print an error and exit non-zero. */
export function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

/** Write a file, refusing to clobber an existing one. */
export function writeNew(absPath: string, content: string): void {
  if (existsSync(absPath)) {
    fail(`Refusing to overwrite existing file:\n  ${absPath}`);
  }
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, "utf8");
}

export const toCamel = (kebab: string): string =>
  kebab.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

export const toPascal = (kebab: string): string => {
  const c = toCamel(kebab);
  return c.charAt(0).toUpperCase() + c.slice(1);
};

export const toSnake = (kebab: string): string => kebab.replace(/-/g, "_");

export const toTitle = (kebab: string): string =>
  kebab
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
