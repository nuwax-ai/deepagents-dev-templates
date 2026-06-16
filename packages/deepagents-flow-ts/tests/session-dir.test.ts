import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { AppConfigSchema } from "../src/runtime/index.js";
import { resolveSessionDir } from "../src/runtime/services/file-checkpoint-saver.js";

describe("resolveSessionDir", () => {
  it("default ~/.flowagents is isolated by workspace hash", () => {
    const config = AppConfigSchema.parse({});
    const dir = resolveSessionDir(config, "/tmp/project-a");

    expect(dir.startsWith(join(homedir(), ".flowagents"))).toBe(true);
    expect(dir).toMatch(/\.flowagents\/[a-f0-9]{12}$/);
  });

  it("relative paths opt out to workspace-local storage", () => {
    const config = AppConfigSchema.parse({
      memory: { dir: "./.flow-sessions" },
    });

    expect(resolveSessionDir(config, "/tmp/project-a")).toBe(
      resolve("/tmp/project-a", "./.flow-sessions")
    );
  });

  it("non-default absolute paths are used as-is", () => {
    const config = AppConfigSchema.parse({
      memory: { dir: "/tmp/custom-flow-sessions" },
    });

    expect(resolveSessionDir(config, "/tmp/project-a")).toBe("/tmp/custom-flow-sessions");
  });
});
