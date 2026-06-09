import { describe, expect, it } from "vitest";
import { loadTemplateRuntime } from "../../../src/template-runtime.js";

describe("template-runtime AppConfigSchema", () => {
  it("exposes a Zod schema that fills defaults and validates", async () => {
    const runtime = await loadTemplateRuntime();
    const parsed = runtime.AppConfigSchema.parse({});
    expect(parsed.agent.name).toBeTypeOf("string");
    expect(parsed.permissions.mode).toBe("ask");
  });

  it("rejects an invalid permissions mode", async () => {
    const runtime = await loadTemplateRuntime();
    const result = runtime.AppConfigSchema.safeParse({ permissions: { mode: "bogus" } });
    expect(result.success).toBe(false);
  });
});
