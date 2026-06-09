#!/usr/bin/env tsx
/**
 * Codegen: emit config/config-schema.json from the zod AppConfigSchema.
 *
 * Editors (Zed/VSCode) read the `$schema` field in app-agent.config.json to
 * surface autocomplete and inline validation. Regenerate this file whenever
 * config-schema.ts changes -- never hand-edit config-schema.json.
 *
 * Usage:  npm run codegen:config-schema
 * Output: config/config-schema.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AppConfigSchema } from "../src/runtime/config/config-schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const OUT_FILE = resolve(PKG_ROOT, "config/config-schema.json");

// Strip `default` keywords from the emitted JSON Schema. Defaults live in zod
// and are applied at runtime by the loader; surfacing them in the editor
// schema would conflict with the user's hand-edited file.
const schema = zodToJsonSchema(AppConfigSchema, {
  $refStrategy: "none",
  outputPath: undefined,
  target: "jsonSchema7",
}) as Record<string, unknown>;

function stripDefaults(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripDefaults);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "default" || k === "optional" || k === "nullable") continue;
      out[k] = stripDefaults(v);
    }
    return out;
  }
  return node;
}

const cleaned = stripDefaults(schema) as Record<string, unknown>;

// zod's z.object() emits `additionalProperties: false`, which would otherwise
// flag the `$schema` meta-key that app-agent.config.json carries to reference
// this file. Declare it explicitly so editors stay strict on real typos but
// accept the self-reference.
if (cleaned.properties && typeof cleaned.properties === "object") {
  (cleaned.properties as Record<string, unknown>).$schema = {
    type: "string",
    description:
      "Path or URL to this JSON Schema. Editor metadata only; ignored by the runtime loader.",
  };
}

const wrapped = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://deepagents.dev/schemas/app-agent.config.v1.json",
  title: "App Agent Config",
  description:
    "Schema for config/app-agent.config.json. Defaults are applied at runtime by the zod loader, not enforced by this schema.",
  ...cleaned,
};

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(wrapped, null, 2) + "\n", "utf8");
console.log(`Wrote ${OUT_FILE}`);
