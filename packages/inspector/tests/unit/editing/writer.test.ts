import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTemplateRuntime, type AppConfig } from "../../../src/template-runtime.js";
import { previewEdits, applyEdits } from "../../../src/editing/writer.js";
import { hashContent } from "../../../src/editing/paths.js";
import { readConfigSource } from "../../../src/editing/config-source.js";

let root: string;
let config: AppConfig;
const CFG = "config/app-agent.config.json";
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "inspector-writer-"));
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "prompts"), { recursive: true });
  writeFileSync(join(root, CFG), JSON.stringify({ model: { name: "claude-x" } }, null, 2), "utf-8");
  writeFileSync(join(root, "prompts/sys.md"), "hello", "utf-8");
  const runtime = await loadTemplateRuntime();
  config = await runtime.loadConfig({ workspaceRoot: root, configPath: CFG });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("writer", () => {
  it("preview returns per-file before/after without writing", async () => {
    const runtime = await loadTemplateRuntime();
    const preview = previewEdits(runtime, root, CFG, config, {
      config: { "model.name": "gpt-4o" },
      text: [{ path: "prompts/sys.md", content: "world", baseHash: hashContent("hello") }],
    });
    expect(preview.validation.ok).toBe(true);
    const cfgDiff = preview.files.find((f) => f.path === CFG)!;
    expect(cfgDiff.after).toContain("gpt-4o");
    expect(readFileSync(join(root, "prompts/sys.md"), "utf-8")).toBe("hello"); // not written
  });

  it("apply writes files and re-validates", async () => {
    const runtime = await loadTemplateRuntime();
    const result = applyEdits(runtime, root, CFG, config, {
      config: { "model.name": "gpt-4o" },
      text: [{ path: "prompts/sys.md", content: "world", baseHash: hashContent("hello") }],
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(root, CFG), "utf-8")).model.name).toBe("gpt-4o");
    expect(readFileSync(join(root, "prompts/sys.md"), "utf-8")).toBe("world");
  });

  it("rejects invalid config (gate 1) and writes nothing", async () => {
    const runtime = await loadTemplateRuntime();
    const result = applyEdits(runtime, root, CFG, config, { config: { "permissions.mode": "nope" }, text: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/Invalid enum value/);
    expect(JSON.parse(readFileSync(join(root, CFG), "utf-8")).model.name).toBe("claude-x");
  });

  it("rejects a target path under deniedPaths (gate 3)", async () => {
    const runtime = await loadTemplateRuntime();
    const result = applyEdits(runtime, root, CFG, config, {
      config: {},
      text: [{ path: "src/runtime/x.ts", content: "x", baseHash: hashContent("") }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.message).toMatch(/denied/i);
  });

  it("rejects a stale baseHash for text (gate 4) and writes nothing", async () => {
    const runtime = await loadTemplateRuntime();
    const result = applyEdits(runtime, root, CFG, config, {
      config: {},
      text: [{ path: "prompts/sys.md", content: "world", baseHash: "stale" }],
    });
    expect(result.ok).toBe(false);
    expect(readFileSync(join(root, "prompts/sys.md"), "utf-8")).toBe("hello");
  });

  it("rejects a stale configBaseHash (gate 2) and writes nothing", async () => {
    const runtime = await loadTemplateRuntime();
    const baseline = readConfigSource(root, CFG).hash;
    // Mutate the on-disk file out from under the request.
    writeFileSync(join(root, CFG), JSON.stringify({ model: { name: "claude-OTHER" } }, null, 2), "utf-8");
    const result = applyEdits(runtime, root, CFG, config, {
      config: { "model.name": "gpt-4o" },
      configBaseHash: baseline,
      text: [],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.path).toBe(CFG);
      expect(result.errors[0]?.message).toMatch(/changed on disk/i);
    }
    // The clobber must not have happened.
    expect(JSON.parse(readFileSync(join(root, CFG), "utf-8")).model.name).toBe("claude-OTHER");
  });

  it("omitting configBaseHash keeps the legacy behavior (no OCC check)", async () => {
    const runtime = await loadTemplateRuntime();
    writeFileSync(join(root, CFG), JSON.stringify({ model: { name: "claude-OTHER" } }, null, 2), "utf-8");
    const result = applyEdits(runtime, root, CFG, config, {
      config: { "model.name": "gpt-4o" },
      // no configBaseHash
      text: [],
    });
    expect(result.ok).toBe(true);
    expect(JSON.parse(readFileSync(join(root, CFG), "utf-8")).model.name).toBe("gpt-4o");
  });
});
