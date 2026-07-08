import { describe, expect, it } from "vitest";
import { createPlatformToolDescriptors } from "../src/runtime/platform-tools/descriptor.js";
import { schemaToZodInput } from "../src/runtime/platform-tools/schema-to-zod.js";

describe("platform schema-driven tooling", () => {
  it("将 spec.tools 展开为 descriptor（按 toolName 一条）", () => {
    const descriptors = createPlatformToolDescriptors([
      {
        targetType: "Plugin",
        targetId: 309,
        name: "联网搜索",
        toolNames: ["web_search", "hot_search"],
        schema: {
          input: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      },
    ]);
    expect(descriptors).toHaveLength(2);
    expect(descriptors.map((d) => d.toolName)).toEqual(["web_search", "hot_search"]);
    expect(descriptors[0]?.targetId).toBe(309);
  });

  it("schemaToZodInput 支持 object 必填与 optional 字段", () => {
    const schema = schemaToZodInput({
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["query"],
    });

    expect(() => schema.parse({ query: "hello" })).not.toThrow();
    expect(() => schema.parse({ limit: 3 })).toThrow();
  });
});
