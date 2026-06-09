import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { inspectAgent } from "../../../src/inspector.js";

const templateRoot = resolve(process.cwd(), "../template");

describe("editable projection", () => {
  it("includes an editable block with fields and provenance", async () => {
    const spec = await inspectAgent({
      workspaceRoot: templateRoot,
      configPath: "config/app-agent.config.json",
    });
    expect(spec.editable).toBeDefined();
    const modelName = spec.editable!.fields.find((f) => f.configPath === "model.name");
    expect(modelName).toBeDefined();
    expect(modelName!.type).toBe("string");
    expect(typeof modelName!.overridden).toBe("boolean");
  });
});
