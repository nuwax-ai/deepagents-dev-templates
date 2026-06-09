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
import { buildPermissions, buildAgentConfigParts, resolveSandboxPolicy } from "../../src/runtime/helpers.js";
import type { AppConfig } from "../../src/runtime/config/config-loader.js";

function makeConfig(deniedPaths: string[], sandbox?: Partial<AppConfig["sandbox"]>): AppConfig {
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
    sandbox,
  } as unknown as AppConfig;
}

/**
 * Build a full AppConfig with a chosen permissions mode and optional sandbox
 * profile. Used for the yolo × sandbox-profile matrix tests below.
 */
function makeFullConfig(
  mode: AppConfig["permissions"]["mode"],
  sandboxProfile: AppConfig["sandbox"]["profile"]
): AppConfig {
  return {
    agent: {
      name: "test-agent",
      description: "test",
      version: "0.0.0",
      outputStyle: "concise",
      includeWorkspaceInstructions: false,
      systemPromptPath: "",
    },
    model: {
      provider: "anthropic",
      name: "claude-sonnet-4-6",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      authTokenEnv: "ANTHROPIC_AUTH_TOKEN",
      settings: { temperature: 0, maxTokens: 4096 },
    },
    permissions: {
      mode,
      interruptOn: ["write_file", "edit_file", "execute"],
      allowedPaths: [],
      deniedPaths: [],
    },
    sandbox: {
      profile: sandboxProfile,
      writablePaths: ["src/app/", "prompts/", "skills/", "config/"],
      deniedWritePaths: ["src/runtime/"],
      environment: { allowedEnv: [], secretEnv: [] },
    },
    hooks: [],
    middleware: {
      stuckLoopDetection: { enabled: false, threshold: 3, mode: "warn" },
      periodicReminder: { enabled: false, firstAt: 5, every: 10 },
      costTracking: { enabled: false, warnAtTokens: 100000 },
    },
    compaction: { enabled: false, contextWindow: 200_000, triggerThreshold: 0.8, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    eviction: { enabled: false, tokenLimit: 20_000, charPerToken: 4, headLines: 5, tailLines: 5, evictionPath: "/large_tool_results" },
    skills: { directories: [], progressiveLoading: true },
    agentsDirectories: [],
    memory: { enabled: false, dir: "./.agent-memory", addCacheControl: true },
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

  it("uses workspace-write sandbox denied paths when configured", () => {
    const config = makeConfig(["legacy-deny/"], {
      profile: "workspace-write",
      writablePaths: ["src/app/"],
      deniedWritePaths: ["src/runtime/", "dist/"],
      environment: { allowedEnv: [], secretEnv: [] },
    });

    const policy = resolveSandboxPolicy(config);
    const denies = buildPermissions(config, workspaceRoot).filter((p) => p.mode === "deny");

    expect(policy.profile).toBe("workspace-write");
    expect(denies.map((deny) => deny.paths[0])).toEqual([
      "/Users/dev/my-project/src/runtime/**",
      "/Users/dev/my-project/dist/**",
    ]);
  });

  it("supports read-only and open sandbox profiles", () => {
    const readOnly = buildPermissions(
      makeConfig(["src/runtime/"], {
        profile: "read-only",
        writablePaths: [],
        deniedWritePaths: [],
        environment: { allowedEnv: [], secretEnv: [] },
      }),
      workspaceRoot
    );
    expect(readOnly[0]).toMatchObject({
      mode: "deny",
      operations: ["write"],
      paths: ["/**"],
    });

    const open = buildPermissions(
      makeConfig(["src/runtime/"], {
        profile: "open",
        writablePaths: ["/**"],
        deniedWritePaths: [],
        environment: { allowedEnv: [], secretEnv: [] },
      }),
      workspaceRoot
    );
    expect(open.filter((permission) => permission.mode === "deny")).toEqual([]);
  });
});

describe("buildAgentConfigParts — protected-paths middleware gating (I-1 regression)", () => {
  /**
   * Regression: previously the `createProtectedPathsMiddleware` push lived
   * inside the `else` branch (mode !== "yolo"), so yolo + workspace-write
   * and yolo + read-only were silently unprotected (the `permissions` array
   * is dropped by `DeepAgentsServer` in ACP mode). The middleware is now
   * gated only on `sandbox.deniedWritePaths.length > 0`, regardless of mode.
   */

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const findProtectedPaths = (parts: any) =>
    (parts.middleware as Array<{ name?: string }>).find((m) => m.name === "protected-paths");

  it("yolo + workspace-write pushes protected-paths middleware", () => {
    const parts = buildAgentConfigParts(
      makeFullConfig("yolo", "workspace-write"),
      undefined,
      "/Users/dev/project",
      []
    );
    expect(findProtectedPaths(parts)).toBeDefined();
  });

  it("yolo + read-only pushes protected-paths middleware", () => {
    const parts = buildAgentConfigParts(
      makeFullConfig("yolo", "read-only"),
      undefined,
      "/Users/dev/project",
      []
    );
    const mw = findProtectedPaths(parts);
    expect(mw).toBeDefined();
    // The /** glob construction is covered by the buildPermissions
    // "supports read-only and open sandbox profiles" test above; this
    // test only asserts the middleware is in the stack (the regression
    // vector for I-1 was missing middleware, not wrong globs).
  });

  it("yolo + open does NOT push protected-paths middleware", () => {
    // open profile → deniedWritePaths = [] → no deny rules → no middleware.
    const config = makeFullConfig("yolo", "open");
    // The `open` profile ignores the sandbox's deniedWritePaths and returns [].
    // Confirm by checking the sandbox policy first.
    const policy = resolveSandboxPolicy(config);
    expect(policy.deniedWritePaths).toEqual([]);

    const parts = buildAgentConfigParts(config, undefined, "/Users/dev/project", []);
    expect(findProtectedPaths(parts)).toBeUndefined();
  });
});
