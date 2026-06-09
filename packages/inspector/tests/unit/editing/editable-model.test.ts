import { describe, expect, it } from "vitest";
import { EDITABLE_CONFIG_FIELDS, findField, groupBySection } from "../../../src/editing/editable-model.js";

describe("editable-model", () => {
  it("declares model and permissions fields with correct types", () => {
    expect(findField("model.name")?.type).toBe("string");
    expect(findField("model.provider")?.type).toBe("enum");
    expect(findField("model.provider")?.enumValues).toEqual(["anthropic", "openai"]);
    expect(findField("permissions.mode")?.enumValues).toEqual(["yolo", "ask", "plan"]);
    expect(findField("model.settings.temperature")?.type).toBe("number");
  });

  it("every field carries a widget in the allowed widget set", () => {
    const allowedWidgets = new Set(["dropdown", "number", "text", "switch", "taglist", "textarea"]);
    for (const field of EDITABLE_CONFIG_FIELDS) {
      expect(allowedWidgets.has(field.widget), `${field.configPath} has bad widget ${field.widget}`).toBe(true);
    }
  });

  it("enum and string[] fields always render as dropdown / taglist", () => {
    for (const field of EDITABLE_CONFIG_FIELDS) {
      if (field.type === "enum") expect(field.widget).toBe("dropdown");
      if (field.type === "string[]") expect(field.widget).toBe("taglist");
      if (field.type === "boolean") expect(field.widget).toBe("switch");
      if (field.type === "number") expect(field.widget).toBe("number");
    }
  });

  it("exposes 30 fields spanning meta, model, permissions, middleware, lifecycle, memory, skills", () => {
    expect(EDITABLE_CONFIG_FIELDS.length).toBe(30);
    const sections = new Set(EDITABLE_CONFIG_FIELDS.map((f) => f.section));
    for (const required of ["meta", "model", "permissions", "middleware", "lifecycle", "memory", "skills"]) {
      expect(sections.has(required)).toBe(true);
    }
  });

  it("has unique field ids that equal their configPath", () => {
    const ids = EDITABLE_CONFIG_FIELDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const field of EDITABLE_CONFIG_FIELDS) {
      expect(field.id).toBe(field.configPath);
    }
  });

  it("includes the secrets-name and middleware-numeric-param fields promised in the plan", () => {
    for (const path of [
      "model.apiKeyEnv",
      "model.authTokenEnv",
      "agent.systemPromptPath",
      "agent.includeWorkspaceInstructions",
      "middleware.stuckLoopDetection.threshold",
      "middleware.stuckLoopDetection.mode",
      "middleware.periodicReminder.firstAt",
      "middleware.periodicReminder.every",
      "middleware.costTracking.warnAtTokens",
    ]) {
      expect(findField(path), `missing field: ${path}`).toBeDefined();
    }
  });

  it("groupBySection preserves order within a section", () => {
    const groups = groupBySection(EDITABLE_CONFIG_FIELDS);
    const modelGroup = groups.get("model")!;
    expect(modelGroup[0]?.configPath).toBe("model.provider");
    expect(modelGroup[modelGroup.length - 1]?.configPath).toBe("model.settings.maxTokens");
  });
});
