/**
 * Unit tests for buildPermissions().
 *
 * Verifies that:
 *  - Relative denied paths are resolved against workspaceRoot into absolute globs
 *  - Absolute denied paths are preserved as-is
 *  - Paths not ending in `/` get a `/` appended before `**` is suffixed
 *  - The deny rule comes before the allow-all catch-all (first-match-wins
 *    semantics in deepagents' decidePathAccess)
 */

import { describe, it, expect } from "vitest";
import { buildPermissions } from "../../src/runtime/helpers.js";
import type { AppConfig } from "../../src/runtime/config-loader.js";

function makeConfig(deniedPaths: string[]): AppConfig {
  return {
    agent: { name: "test-agent" },
    model: {
      provider: "anthropic",
      name: "claude-sonnet-4-6",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      authTokenEnv: "ANTHROPIC_AUTH_TOKEN",
      settings: { temperature: 0, maxTokens: 4096 },
    },
    permissions: {
      mode: "ask",
      interruptOn: ["write_file", "edit_file", "execute"],
      allowedPaths: [],
      deniedPaths,
    },
  } as unknown as AppConfig;
}

describe("buildPermissions", () => {
  const workspaceRoot = "/Users/dev/my-project";

  it("resolves a relative denied path against workspaceRoot into an absolute glob", () => {
    const perms = buildPermissions(makeConfig(["src/runtime/"]), workspaceRoot);
    const deny = perms.find((p) => p.mode === "deny");
    expect(deny).toBeDefined();
    expect(deny!.operations).toEqual(["write"]);
    // The bug this regression test guards: previously this was `/src/runtime/**`
    // (a backend-rooted glob) which never matched the OS-absolute file_path the
    // agent passes. After the fix, it should be the absolute glob.
    expect(deny!.paths).toEqual(["/Users/dev/my-project/src/runtime/**"]);
  });

  it("appends a trailing / before ** when the input lacks one", () => {
    const perms = buildPermissions(makeConfig(["src/runtime"]), workspaceRoot);
    const deny = perms.find((p) => p.mode === "deny");
    expect(deny!.paths).toEqual(["/Users/dev/my-project/src/runtime/**"]);
  });

  it("preserves an absolute denied path verbatim", () => {
    const perms = buildPermissions(makeConfig(["/abs/path/"]), workspaceRoot);
    const deny = perms.find((p) => p.mode === "deny");
    expect(deny!.paths).toEqual(["/abs/path/**"]);
  });

  it("emits the deny rule before the allow-all catch-all (first-match-wins)", () => {
    const perms = buildPermissions(makeConfig(["src/runtime/"]), workspaceRoot);
    expect(perms[0]!.mode).toBe("deny");
    expect(perms[perms.length - 1]!.mode).toBe("allow");
    expect(perms[perms.length - 1]!.paths).toEqual(["/**"]);
  });

  it("emits a deny rule for each entry in deniedPaths", () => {
    const perms = buildPermissions(
      makeConfig(["src/runtime/", "prompts/"]),
      workspaceRoot
    );
    const denies = perms.filter((p) => p.mode === "deny");
    expect(denies).toHaveLength(2);
    expect(denies[0]!.paths).toEqual(["/Users/dev/my-project/src/runtime/**"]);
    expect(denies[1]!.paths).toEqual(["/Users/dev/my-project/prompts/**"]);
  });

  it("falls back to the backend-rooted glob when workspaceRoot is omitted", () => {
    // Backward-compat: callers that don't pass workspaceRoot still get a glob,
    // just one that doesn't match OS-absolute file_paths. Documented behavior.
    const perms = buildPermissions(makeConfig(["src/runtime/"]));
    const deny = perms.find((p) => p.mode === "deny");
    expect(deny!.paths).toEqual(["/src/runtime/**"]);
  });
});
