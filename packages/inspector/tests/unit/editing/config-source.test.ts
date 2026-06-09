import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTemplateRuntime } from "../../../src/template-runtime.js";
import { readConfigSource, patchConfigSource, validateConfig } from "../../../src/editing/config-source.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "inspector-cfg-"));
  mkdirSync(join(root, "config"), { recursive: true });
  writeFileSync(
    join(root, "config/app-agent.config.json"),
    JSON.stringify({ model: { name: "claude-x" } }, null, 2),
    "utf-8"
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("config-source", () => {
  it("reads the raw source with a hash", () => {
    const src = readConfigSource(root, "config/app-agent.config.json");
    expect((src.raw.model as { name: string }).name).toBe("claude-x");
    expect(src.hash).toBeTypeOf("string");
  });

  it("applies a flat dot-path patch immutably", () => {
    const src = readConfigSource(root, "config/app-agent.config.json");
    const patched = patchConfigSource(src.raw, { "model.name": "gpt-4o", "permissions.mode": "yolo" });
    expect((patched.model as { name: string }).name).toBe("gpt-4o");
    expect((patched.permissions as { mode: string }).mode).toBe("yolo");
  });

  it("validates a patched source against AppConfigSchema", async () => {
    const runtime = await loadTemplateRuntime();
    const ok = validateConfig(runtime, { model: { name: "gpt-4o" } });
    expect(ok.ok).toBe(true);
    const bad = validateConfig(runtime, { permissions: { mode: "nope" } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]?.path).toContain("permissions");
  });
});
