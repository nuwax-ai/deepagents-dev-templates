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
    expect(modelName!.widget).toBe("text");
    expect(typeof modelName!.overridden).toBe("boolean");
  });

  it("exposes the renamed configFile and the new configBaseHash", async () => {
    const spec = await inspectAgent({
      workspaceRoot: templateRoot,
      configPath: "config/app-agent.config.json",
    });
    expect(spec.editable!.configFile).toBe("config/app-agent.config.json");
    expect(typeof spec.editable!.configBaseHash).toBe("string");
    expect(spec.editable!.configBaseHash.length).toBeGreaterThan(0);
    // spec must NOT have the old field name
    expect((spec.editable as unknown as { configPath?: string }).configPath).toBeUndefined();
  });

  it("each editable field has a widget in the allowed widget set", async () => {
    const spec = await inspectAgent({
      workspaceRoot: templateRoot,
      configPath: "config/app-agent.config.json",
    });
    const allowedWidgets = new Set(["dropdown", "number", "text", "switch", "taglist", "textarea"]);
    for (const field of spec.editable!.fields) {
      expect(allowedWidgets.has(field.widget), `${field.configPath} has bad widget ${field.widget}`).toBe(true);
    }
  });
});
