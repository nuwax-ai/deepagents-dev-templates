#!/usr/bin/env npx tsx
/**
 * sync-version.ts
 *
 * Reads the version from package.json and writes it into:
 *   - agent-package.json  (version, source.version, source.prefix, alternativeSources)
 *   - config/app-agent.config.json  (agent.version)
 *
 * Usage:
 *   npx tsx scripts/sync-version.ts          # sync to all targets
 *   npx tsx scripts/sync-version.ts --check  # exit 1 if out of sync
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PKG_JSON = resolve(ROOT, "package.json");
const AGENT_PKG_JSON = resolve(ROOT, "agent-package.json");
const APP_CONFIG_JSON = resolve(ROOT, "config", "app-agent.config.json");

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

const pkg = readJson(PKG_JSON) as { version: string };
const version = pkg.version;

const checkOnly = process.argv.includes("--check");

let changed = false;

// ─── agent-package.json ──────────────────────────────────
const agentPkg = readJson(AGENT_PKG_JSON) as {
  version: string;
  source: { prefix: string; version: string };
  alternativeSources: Array<{ version?: string; path?: string; ref?: string }>;
};

const fields: string[] = [];

if (agentPkg.version !== version) {
  fields.push("version");
  agentPkg.version = version;
}

if (agentPkg.source.version !== version) {
  fields.push("source.version");
  agentPkg.source.version = version;
}

// Update the S3 prefix path to include the new version
const prefixParts = agentPkg.source.prefix.split("/");
prefixParts[prefixParts.length - 1] = version;
const newPrefix = prefixParts.join("/");
if (agentPkg.source.prefix !== newPrefix) {
  fields.push("source.prefix");
  agentPkg.source.prefix = newPrefix;
}

for (const alt of agentPkg.alternativeSources) {
  if (alt.version !== undefined && alt.version !== version) {
    alt.version = version;
    fields.push(`alternativeSources[${agentPkg.alternativeSources.indexOf(alt)}].version`);
  }
}

if (fields.length > 0) {
  if (checkOnly) {
    console.error(`agent-package.json out of sync: ${fields.join(", ")}`);
    process.exit(1);
  }
  writeJson(AGENT_PKG_JSON, agentPkg);
  console.log(`agent-package.json: synced ${fields.join(", ")} → ${version}`);
  changed = true;
}

// ─── config/app-agent.config.json ────────────────────────
const appConfig = readJson(APP_CONFIG_JSON) as {
  agent: { version: string };
};

if (appConfig.agent.version !== version) {
  if (checkOnly) {
    console.error(`app-agent.config.json out of sync: agent.version = ${appConfig.agent.version}`);
    process.exit(1);
  }
  appConfig.agent.version = version;
  writeJson(APP_CONFIG_JSON, appConfig);
  console.log(`app-agent.config.json: synced agent.version → ${version}`);
  changed = true;
}

if (!changed) {
  console.log(`All version references already in sync: ${version}`);
}
