import { describe, expect, it } from "vitest";
import { getByPath, setByPath, hashContent } from "../../../src/editing/paths.js";

describe("paths", () => {
  it("gets a nested value by dot path", () => {
    expect(getByPath({ model: { name: "x" } }, "model.name")).toBe("x");
    expect(getByPath({ model: {} }, "model.name")).toBeUndefined();
  });

  it("sets a nested value immutably, creating intermediate objects", () => {
    const src = { model: { name: "x" } };
    const out = setByPath(src, "model.settings.temperature", 0.5);
    expect(out).toEqual({ model: { name: "x", settings: { temperature: 0.5 } } });
    expect(src).toEqual({ model: { name: "x" } }); // unchanged
  });

  it("hashes content stably", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
  });
});
