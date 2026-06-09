import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approvalsPath, listApprovals, saveApproval } from "../../../src/runtime/storage/approvals.js";

describe("approval store", () => {
  const originalEnv = { ...process.env };
  let tmpDir: string;
  let workspaceRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "approvals-test-"));
    workspaceRoot = join(tmpDir, "workspace");
    process.env.DEEPAGENTS_HOME = join(tmpDir, "home");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores approvals under ~/.deepagents/approvals.json and filters by workspace", () => {
    const saved = saveApproval({
      workspaceRoot,
      toolName: "execute",
      decision: "allow",
      command: "npm test",
    });

    expect(approvalsPath()).toBe(join(tmpDir, "home", "approvals.json"));
    expect(saved.commandHash).toBeDefined();
    expect(listApprovals(workspaceRoot)).toHaveLength(1);
    expect(listApprovals(join(tmpDir, "other"))).toHaveLength(0);
  });
});
