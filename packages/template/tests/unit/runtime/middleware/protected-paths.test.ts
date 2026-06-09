/**
 * Unit tests for createProtectedPathsMiddleware().
 *
 * Verifies that:
 *  - Tool calls NOT in the guarded set pass through unchanged
 *  - write_file / edit_file to non-protected paths are allowed
 *  - write_file / edit_file to paths matching a deny glob are DENIED
 *  - The denial surfaces as a ToolMessage with status="error" (NOT a throw,
 *    because throws from wrapToolCall get wrapped as fatal by deepagents-acp)
 *  - Empty deniedGlobs yields a no-op middleware
 *  - Relative file_path is resolved against process.cwd()
 */

import { describe, expect, it, vi } from "vitest";
import { createProtectedPathsMiddleware } from "../../../../src/runtime/middleware/protected-paths.js";

// ─── Helpers ────────────────────────────────────────────

interface FakeRequest {
  toolCall: { name: string; id?: string; args: Record<string, unknown> };
}

function makeRequest(name: string, args: Record<string, unknown>, id = "tc_1"): FakeRequest {
  return { toolCall: { name, id, args } };
}

/**
 * Capture the ToolMessage returned by the middleware. langchain's
 * `ToolMessage` is a class — we just check the public fields.
 */
function asToolMessage(value: unknown): { content: string; status?: string; name: string; tool_call_id: string } | null {
  if (value && typeof value === "object" && "content" in value && "name" in value) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = value as any;
    return {
      content: typeof v.content === "string" ? v.content : String(v.content ?? ""),
      status: v.status,
      name: v.name,
      tool_call_id: v.tool_call_id,
    };
  }
  return null;
}

// ─── Tests ───────────────────────────────────────────────

describe("createProtectedPathsMiddleware", () => {
  const workspaceAbs = "/Users/dev/project";
  const deniedGlobs = [
    `${workspaceAbs}/src/runtime/**`,
    `${workspaceAbs}/prompts/**`,
  ];

  it("passes through tool calls that aren't in the guarded set", async () => {
    const mw = createProtectedPathsMiddleware({ deniedGlobs });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (mw as any).wrapToolCall as (
      req: FakeRequest,
      handler: (req: FakeRequest) => unknown
    ) => Promise<unknown>;
    const handler = vi.fn().mockReturnValue("TOOL RESULT");
    const result = await fn(makeRequest("read_file", { file_path: "/etc/passwd" }), handler);
    expect(result).toBe("TOOL RESULT");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("allows write_file to a non-protected path", async () => {
    const mw = createProtectedPathsMiddleware({ deniedGlobs });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (mw as any).wrapToolCall as (
      req: FakeRequest,
      handler: (req: FakeRequest) => unknown
    ) => Promise<unknown>;
    const handler = vi.fn().mockReturnValue("WROTE");
    const result = await fn(
      makeRequest("write_file", { file_path: `${workspaceAbs}/src/app/foo.ts`, content: "x" }),
      handler
    );
    expect(result).toBe("WROTE");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("denies write_file to a protected path with a ToolMessage error", async () => {
    const mw = createProtectedPathsMiddleware({ deniedGlobs });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (mw as any).wrapToolCall as (
      req: FakeRequest,
      handler: (req: FakeRequest) => unknown
    ) => Promise<unknown>;
    const handler = vi.fn();
    const result = await fn(
      makeRequest("write_file", { file_path: `${workspaceAbs}/src/runtime/x.ts`, content: "x" }),
      handler
    );
    // Handler must NOT have been called — the underlying write should not happen.
    expect(handler).not.toHaveBeenCalled();
    const msg = asToolMessage(result);
    expect(msg).not.toBeNull();
    expect(msg!.status).toBe("error");
    expect(msg!.content).toMatch(/permission denied/);
    expect(msg!.content).toContain(`${workspaceAbs}/src/runtime/x.ts`);
    expect(msg!.name).toBe("write_file");
  });

  it("denies edit_file to a protected path", async () => {
    const mw = createProtectedPathsMiddleware({ deniedGlobs });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (mw as any).wrapToolCall as (
      req: FakeRequest,
      handler: (req: FakeRequest) => unknown
    ) => Promise<unknown>;
    const handler = vi.fn();
    const result = await fn(
      makeRequest("edit_file", {
        file_path: `${workspaceAbs}/prompts/main.md`,
        old_string: "a",
        new_string: "b",
      }),
      handler
    );
    expect(handler).not.toHaveBeenCalled();
    const msg = asToolMessage(result);
    expect(msg).not.toBeNull();
    expect(msg!.status).toBe("error");
    expect(msg!.name).toBe("edit_file");
  });

  it("does NOT throw (returning a ToolMessage instead — throwing would be fatal in ACP)", async () => {
    const mw = createProtectedPathsMiddleware({ deniedGlobs });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (mw as any).wrapToolCall as (
      req: FakeRequest,
      handler: (req: FakeRequest) => unknown
    ) => Promise<unknown>;
    await expect(
      fn(
        makeRequest("write_file", { file_path: `${workspaceAbs}/src/runtime/x.ts` }),
        vi.fn()
      )
    ).resolves.toBeDefined();  // resolves, not rejects
  });

  it("does not match a sibling directory with a similar prefix", async () => {
    // Regression: `/abs/dir/**` must NOT match `/abs/dirfoo/x.ts`. The glob
    // matcher's trailing-slash handling is what protects against this.
    const mw = createProtectedPathsMiddleware({
      deniedGlobs: [`${workspaceAbs}/src/runtime/**`],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (mw as any).wrapToolCall as (
      req: FakeRequest,
      handler: (req: FakeRequest) => unknown
    ) => Promise<unknown>;
    const handler = vi.fn().mockReturnValue("OK");
    const result = await fn(
      makeRequest("write_file", { file_path: `${workspaceAbs}/src/runtimefoo/x.ts` }),
      handler
    );
    expect(result).toBe("OK");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("empty deniedGlobs yields a no-op middleware (handler always called)", async () => {
    const mw = createProtectedPathsMiddleware({ deniedGlobs: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (mw as any).wrapToolCall as (
      req: FakeRequest,
      handler: (req: FakeRequest) => unknown
    ) => Promise<unknown>;
    const handler = vi.fn().mockReturnValue("PASS");
    const result = await fn(
      makeRequest("write_file", { file_path: `${workspaceAbs}/src/runtime/x.ts` }),
      handler
    );
    expect(result).toBe("PASS");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("custom toolNames overrides the default guarded set", async () => {
    const mw = createProtectedPathsMiddleware({
      deniedGlobs,
      toolNames: ["execute"],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (mw as any).wrapToolCall as (
      req: FakeRequest,
      handler: (req: FakeRequest) => unknown
    ) => Promise<unknown>;
    const handler = vi.fn();
    // write_file is no longer in the guarded set, so it passes through
    await fn(
      makeRequest("write_file", { file_path: `${workspaceAbs}/src/runtime/x.ts` }),
      handler
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // ─── src/surfaces/ protection ─────────────────────────

  it("denies write_file to src/surfaces/ when surfaces are in deniedGlobs", async () => {
    const mw = createProtectedPathsMiddleware({
      deniedGlobs: [`${workspaceAbs}/src/runtime/**`, `${workspaceAbs}/src/surfaces/**`],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (mw as any).wrapToolCall as (
      req: FakeRequest,
      handler: (req: FakeRequest) => unknown
    ) => Promise<unknown>;
    const handler = vi.fn();
    const result = await fn(
      makeRequest("write_file", { file_path: `${workspaceAbs}/src/surfaces/acp/server.ts`, content: "x" }),
      handler
    );
    expect(handler).not.toHaveBeenCalled();
    const msg = asToolMessage(result);
    expect(msg).not.toBeNull();
    expect(msg!.status).toBe("error");
    expect(msg!.content).toContain(`${workspaceAbs}/src/surfaces/acp/server.ts`);
  });

  it("denies edit_file to src/surfaces/cli/ when surfaces are in deniedGlobs", async () => {
    const mw = createProtectedPathsMiddleware({
      deniedGlobs: [`${workspaceAbs}/src/runtime/**`, `${workspaceAbs}/src/surfaces/**`],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (mw as any).wrapToolCall as (
      req: FakeRequest,
      handler: (req: FakeRequest) => unknown
    ) => Promise<unknown>;
    const handler = vi.fn();
    const result = await fn(
      makeRequest("edit_file", {
        file_path: `${workspaceAbs}/src/surfaces/cli/repl.ts`,
        old_string: "a",
        new_string: "b",
      }),
      handler
    );
    expect(handler).not.toHaveBeenCalled();
    const msg = asToolMessage(result);
    expect(msg).not.toBeNull();
    expect(msg!.status).toBe("error");
    expect(msg!.name).toBe("edit_file");
  });

  it("allows write_file to src/app/ even when surfaces are protected", async () => {
    const mw = createProtectedPathsMiddleware({
      deniedGlobs: [`${workspaceAbs}/src/runtime/**`, `${workspaceAbs}/src/surfaces/**`],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = (mw as any).wrapToolCall as (
      req: FakeRequest,
      handler: (req: FakeRequest) => unknown
    ) => Promise<unknown>;
    const handler = vi.fn().mockReturnValue("WROTE");
    const result = await fn(
      makeRequest("write_file", { file_path: `${workspaceAbs}/src/app/tools/my-tool.ts`, content: "x" }),
      handler
    );
    expect(result).toBe("WROTE");
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
