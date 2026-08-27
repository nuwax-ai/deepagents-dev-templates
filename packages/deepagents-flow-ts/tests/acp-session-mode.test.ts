/**
 * ACP session mode 生效逻辑 —— set_mode 记录的 mode 在 onPrompt 折算为
 * 权限门控（plan 扩大 interruptOn）与输入指令注入（plan 追加规划指令）。
 */

import { describe, it, expect } from "vitest";
import {
  applySessionModeToPermissions,
  applySessionModeToQuery,
  PLAN_MODE_DIRECTIVE,
} from "../src/surfaces/acp/server.js";

describe("applySessionModeToPermissions", () => {
  const base = { mode: "ask", interruptOn: ["write_file"] };

  it("keeps the appConfig default when no session mode is set", () => {
    expect(applySessionModeToPermissions(base, undefined)).toEqual(base);
  });

  it("agent / unknown modes keep the appConfig default", () => {
    expect(applySessionModeToPermissions(base, "agent")).toEqual(base);
    expect(applySessionModeToPermissions(base, "turbo")).toEqual(base);
  });

  it("ask forces the ask gate", () => {
    expect(applySessionModeToPermissions({ ...base, mode: "yolo" }, "ask")).toEqual({
      mode: "ask",
      interruptOn: ["write_file"],
    });
  });

  it("plan expands interruptOn to all write tools", () => {
    const result = applySessionModeToPermissions(base, "plan");
    expect(result.mode).toBe("plan");
    expect(result.interruptOn).toEqual(
      expect.arrayContaining(["write_file", "edit_file", "bash", "http_request"]),
    );
  });

  it("plan does not duplicate entries already present", () => {
    const result = applySessionModeToPermissions(
      { mode: "ask", interruptOn: ["bash", "bash"] },
      "plan",
    );
    expect(result.interruptOn.filter((tool) => tool === "bash")).toHaveLength(1);
  });
});

describe("applySessionModeToQuery", () => {
  it("appends the plan directive only in plan mode", () => {
    expect(applySessionModeToQuery("build the feature", "plan")).toBe(
      `build the feature\n\n${PLAN_MODE_DIRECTIVE}`,
    );
  });

  it("leaves the input untouched for other modes", () => {
    expect(applySessionModeToQuery("build the feature", "agent")).toBe(
      "build the feature",
    );
    expect(applySessionModeToQuery("build the feature", undefined)).toBe(
      "build the feature",
    );
  });
});
