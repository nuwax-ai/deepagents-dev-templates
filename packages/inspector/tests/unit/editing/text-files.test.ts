import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertEditablePath, isInAllowedPath, readTextFile, writeTextFileAtomic } from "../../../src/editing/text-files.js";
import type { AppConfig } from "../../../src/template-runtime.js";

let root: string;
let config: AppConfig;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "inspector-edit-"));
  mkdirSync(join(root, "prompts"), { recursive: true });
  mkdirSync(join(root, "config"), { recursive: true });
  mkdirSync(join(root, "skills"), { recursive: true });
  mkdirSync(join(root, ".agents"), { recursive: true });
  writeFileSync(join(root, "prompts/sys.md"), "hello", "utf-8");
  // Use the real loader so we exercise the same default-deniedPaths
  // (["src/runtime/", "src/surfaces/"]) the production code reads.
  const { loadTemplateRuntime } = await import("../../../src/template-runtime.js");
  const runtime = await loadTemplateRuntime();
  config = await runtime.loadConfig({ workspaceRoot: root, configPath: "config/app-agent.config.json" });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("text-files", () => {
  it("allows paths inside the workspace that are not denied", () => {
    expect(() => assertEditablePath(root, config, "prompts/sys.md")).not.toThrow();
    expect(() => assertEditablePath(root, config, "config/app-agent.config.json")).not.toThrow();
    expect(() => assertEditablePath(root, config, "skills/foo/SKILL.md")).not.toThrow();
    expect(() => assertEditablePath(root, config, ".agents/agents/x/AGENT.md")).not.toThrow();
  });

  it("rejects paths outside the workspace and absolute paths", () => {
    expect(() => assertEditablePath(root, config, "src/runtime/x.ts")).toThrow();
    expect(() => assertEditablePath(root, config, "src/surfaces/x.ts")).toThrow();
    expect(() => assertEditablePath(root, config, "../outside.md")).toThrow();
    expect(() => assertEditablePath(root, config, "/etc/passwd")).toThrow();
  });

  it("rejects prefix matches against denylist entries (src/runtime-config.json vs src/runtime/)", () => {
    expect(() => assertEditablePath(root, config, "src/runtime-config.json")).not.toThrow();
    expect(() => assertEditablePath(root, config, "src/runtime/x.ts")).toThrow();
    expect(() => assertEditablePath(root, config, "src/runtime/nested/y.ts")).toThrow();
  });

  it("honors user-extended deniedPaths", () => {
    const restricted: AppConfig = {
      ...config,
      permissions: { ...config.permissions, deniedPaths: [...(config.permissions.deniedPaths ?? []), "examples/"] },
    };
    expect(() => assertEditablePath(root, restricted, "examples/foo.md")).toThrow();
    expect(() => assertEditablePath(root, restricted, "prompts/x.md")).not.toThrow();
  });

  it("isInAllowedPath returns true for entries under allowedPaths, false otherwise", () => {
    const cfg: AppConfig = {
      ...config,
      permissions: { ...config.permissions, allowedPaths: ["prompts/"] },
    };
    expect(isInAllowedPath(root, cfg, "prompts/sys.md")).toBe(true);
    expect(isInAllowedPath(root, cfg, "config/app-agent.config.json")).toBe(false);
  });

  it("reads with a content hash and round-trips an atomic write", () => {
    const read = readTextFile(root, config, "prompts/sys.md");
    expect(read?.content).toBe("hello");
    writeTextFileAtomic(root, config, "prompts/sys.md", "world");
    expect(readTextFile(root, config, "prompts/sys.md")?.content).toBe("world");
  });
});
