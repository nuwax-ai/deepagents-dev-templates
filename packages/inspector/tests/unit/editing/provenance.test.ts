import { describe, expect, it } from "vitest";
import { computeProvenance } from "../../../src/editing/provenance.js";
import { EDITABLE_CONFIG_FIELDS } from "../../../src/editing/editable-model.js";

describe("provenance", () => {
  it("flags a field whose merged value differs from the source", () => {
    const rawSource = { model: { name: "claude-x" }, permissions: { mode: "ask" } };
    const merged = { model: { name: "claude-x" }, permissions: { mode: "plan" } }; // env override
    const prov = computeProvenance(rawSource, merged, EDITABLE_CONFIG_FIELDS);
    const mode = prov.find((p) => p.configPath === "permissions.mode")!;
    expect(mode.overridden).toBe(true);
    expect(mode.effectiveValue).toBe("plan");
    const name = prov.find((p) => p.configPath === "model.name")!;
    expect(name.overridden).toBe(false);
  });
});
