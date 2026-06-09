import { describe, expect, it } from "vitest";
import { shouldEvict, createPreview, buildEvictedMessage } from "../../../../src/runtime/middleware/eviction.js";
import type { EvictionConfig } from "../../../../src/runtime/config/config-loader.js";

const DEFAULT_CONFIG: EvictionConfig = {
  enabled: true,
  tokenLimit: 20_000,
  charPerToken: 4,
  headLines: 5,
  tailLines: 5,
  evictionPath: "/large_tool_results",
};

describe("eviction", () => {
  describe("shouldEvict", () => {
    it("returns false when disabled", () => {
      expect(shouldEvict("x".repeat(100_000), { ...DEFAULT_CONFIG, enabled: false })).toBe(false);
    });

    it("returns false for small content", () => {
      expect(shouldEvict("small content", DEFAULT_CONFIG)).toBe(false);
    });

    it("returns true for content over threshold", () => {
      // 20k tokens * 4 chars/token = 80k chars threshold
      const largeContent = "x".repeat(100_000);
      expect(shouldEvict(largeContent, DEFAULT_CONFIG)).toBe(true);
    });

    it("returns false at exact threshold boundary", () => {
      const exactThreshold = "x".repeat(80_000);
      expect(shouldEvict(exactThreshold, DEFAULT_CONFIG)).toBe(false);
    });
  });

  describe("createPreview", () => {
    it("returns full content when short", () => {
      const content = "line1\nline2\nline3";
      expect(createPreview(content, { headLines: 5, tailLines: 5 })).toBe(content);
    });

    it("truncates middle for long content", () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
      const content = lines.join("\n");
      const preview = createPreview(content, { headLines: 5, tailLines: 5 });

      expect(preview).toContain("line1");
      expect(preview).toContain("line20");
      expect(preview).toContain("... [10 lines truncated] ...");
      expect(preview).not.toContain("line7");
    });

    it("shows all lines when exactly at boundary", () => {
      const lines = Array.from({ length: 10 }, (_, i) => `line${i + 1}`);
      const content = lines.join("\n");
      expect(createPreview(content, { headLines: 5, tailLines: 5 })).toBe(content);
    });
  });

  describe("buildEvictedMessage", () => {
    it("contains file path and preview", () => {
      const msg = buildEvictedMessage("tc-123", "read_file", "/results/123.txt", "preview text");

      expect(msg.content).toContain("/results/123.txt");
      expect(msg.content).toContain("preview text");
      expect(msg.content).toContain("read_file");
      expect(msg.tool_call_id).toBe("tc-123");
      expect(msg.name).toBe("read_file");
    });
  });
});
