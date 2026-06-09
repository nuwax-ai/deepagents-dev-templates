import { describe, it, expect, afterEach } from "vitest";
import { getHooks, registerConfiguredHooks, unregisterHook } from "../../../../src/app/hooks/index.js";

describe("configured hooks", () => {
  const registered: string[] = [];

  afterEach(() => {
    for (const name of registered.splice(0)) {
      unregisterHook(name);
    }
  });

  it("registers shell hooks and maps stdout JSON to hook results", async () => {
    registerConfiguredHooks([
      {
        event: "pre_tool_use",
        matcher: "^execute$",
        command: "node -e 'process.stdout.write(JSON.stringify({ modifiedArgs: { command: \"echo ok\" } }))'",
      },
    ], process.cwd());

    const hook = getHooks("pre_tool_use").find((candidate) => candidate.name.includes("echo ok"));
    expect(hook).toBeDefined();
    registered.push(hook!.name);

    const result = await hook!.handler({
      toolName: "execute",
      args: { command: "rm -rf /tmp/nope" },
      timestamp: Date.now(),
    });

    expect(result).toEqual({ modifiedArgs: { command: "echo ok" } });
  });

  it("treats exit code 2 as a tool prevention result", async () => {
    registerConfiguredHooks([
      {
        event: "pre_tool_use",
        matcher: "^write_file$",
        command: "node -e 'process.stdout.write(\"blocked\"); process.exit(2)'",
      },
    ], process.cwd());

    const hook = getHooks("pre_tool_use").find((candidate) => candidate.name.includes("blocked"));
    expect(hook).toBeDefined();
    registered.push(hook!.name);

    const result = await hook!.handler({
      toolName: "write_file",
      args: { path: "src/runtime/x.ts" },
      timestamp: Date.now(),
    });

    expect(result).toEqual({ prevent: true, replacementResult: "blocked" });
  });
});
